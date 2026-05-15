import { NextRequest, NextResponse } from 'next/server';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { r2, r2Bucket } from '@/lib/r2';

export const runtime = 'nodejs';

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

  // Need the r2Key before deleting the row so we can unlink R2 too.
  const photo = await prisma.photo.findUnique({
    where: { id: photoId },
    select: {
      r2Key: true,
      listingId: true,
      listing: { select: { user: { select: { email: true } } } },
    },
  });
  if (!photo || photo.listingId !== id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (photo.listing.user.email !== session.user.email) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // DB delete first — source of truth. R2 cleanup is best-effort:
  // if it fails, the orphaned object falls out via lifecycle policy
  // rather than leaving the row pointing at deleted bytes.
  await prisma.photo.delete({ where: { id: photoId } });

  await r2
    .send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: photo.r2Key }))
    .catch((err) => {
      console.error('[photo:delete] r2 cleanup failed', {
        photoId,
        r2Key: photo.r2Key,
        err,
      });
    });
  // Best-effort thumb cleanup.
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
