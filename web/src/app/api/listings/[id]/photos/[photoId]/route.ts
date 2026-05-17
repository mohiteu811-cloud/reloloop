import { NextRequest, NextResponse } from 'next/server';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { r2, r2Bucket } from '@/lib/r2';

export const runtime = 'nodejs';

// Photos are mutable while a listing is being prepared. Once it's
// LIVE/PROPOSED/LOCKED/SWAPPED/WITHDRAWN the photo set is frozen —
// matching the upload/confirm endpoints' rule.
const MUTABLE_LISTING_STATUSES = ['DRAFT', 'PROCESSING'] as const;

// DELETE /api/listings/:id/photos/:photoId
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; photoId: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id, photoId } = await ctx.params;

  // Read r2Key (and listing status, for error disambiguation) up
  // front so we can unlink R2 after the row is gone. We still do
  // the actual delete as an atomic conditional write below so a
  // concurrent publish between the read and the delete can't strip
  // photos from a now-frozen listing.
  const photo = await prisma.photo.findUnique({
    where: { id: photoId },
    select: {
      r2Key: true,
      listingId: true,
      listing: {
        select: {
          status: true,
          user: { select: { email: true } },
        },
      },
    },
  });
  if (!photo || photo.listingId !== id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (photo.listing.user.email !== session.user.email) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Atomic conditional delete: only removes the row if it still
  // belongs to a mutable-status listing owned by this user.
  const result = await prisma.photo.deleteMany({
    where: {
      id: photoId,
      listingId: id,
      listing: {
        user: { email: session.user.email },
        status: { in: [...MUTABLE_LISTING_STATUSES] },
      },
    },
  });

  if (result.count === 0) {
    // count===0 can happen in two ways under concurrent traffic:
    //   1. Another DELETE for this photo already committed — the
    //      row is gone. Treat as idempotent success so retries are
    //      safe.
    //   2. A publish/transition committed between our read and our
    //      delete — the row exists but the listing is now frozen.
    //      Return 409 with the current status so the client can
    //      tell the user.
    const current = await prisma.photo.findUnique({
      where: { id: photoId },
      select: { listing: { select: { status: true } } },
    });
    if (!current) {
      return NextResponse.json({ deleted: true, alreadyGone: true });
    }
    return NextResponse.json(
      {
        error: 'invalid_status',
        currentStatus: current.listing.status,
      },
      { status: 409 },
    );
  }

  // R2 cleanup is best-effort: if it fails, the orphaned object
  // falls out via lifecycle policy rather than leaving the row
  // pointing at deleted bytes.
  await r2
    .send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: photo.r2Key }))
    .catch((err) => {
      console.error('[photo:delete] r2 cleanup failed', {
        photoId,
        r2Key: photo.r2Key,
        err,
      });
    });
  await r2
    .send(
      new DeleteObjectCommand({
        Bucket: r2Bucket,
        Key: `${photo.r2Key}.thumb.webp`,
      }),
    )
    .catch(() => {});

  return NextResponse.json({ deleted: true });
}
