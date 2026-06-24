import { NextRequest, NextResponse } from 'next/server';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { r2, r2Bucket } from '@/lib/r2';

export const runtime = 'nodejs';

// DRAFT only — PROCESSING locks the listing while the AI worker runs.
const MUTABLE_LISTING_STATUSES = ['DRAFT'] as const;

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; photoId: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id, photoId } = await ctx.params;

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
