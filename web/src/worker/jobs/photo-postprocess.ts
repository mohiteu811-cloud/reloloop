import type { Processor } from 'bullmq';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { r2, r2Bucket, r2PublicUrl } from '../../lib/r2';
import { prisma } from '../../lib/prisma';

export type PhotoPostprocessJob = { photoId: string };

// Carryover-equivalent of LivAround's image-postprocess worker:
// download original, generate a 480px WebP thumbnail (honoring
// EXIF rotation), upload back to R2, persist dimensions + thumb URL.
// Perceptual hash (for dedup) is deferred until we have enough
// listing volume to need dedup; the column stays nullable.
export const photoPostprocessProcessor: Processor<PhotoPostprocessJob> = async (job) => {
  const { photoId } = job.data;

  const photo = await prisma.photo.findUnique({ where: { id: photoId } });
  if (!photo) {
    console.warn(`[photo:postprocess] photo ${photoId} not found, skipping`);
    return { skipped: true };
  }

  // 1. Download original from R2.
  const obj = await r2.send(
    new GetObjectCommand({ Bucket: r2Bucket, Key: photo.r2Key }),
  );
  if (!obj.Body) {
    throw new Error(`r2 object body missing: ${photo.r2Key}`);
  }
  const buffer = Buffer.from(await obj.Body.transformToByteArray());

  // 2. Read metadata + generate the thumbnail.
  const img = sharp(buffer, { failOn: 'truncated' });
  const meta = await img.metadata();
  const thumbBuf = await img
    .rotate() // honors EXIF orientation
    .resize({ width: 480, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  // 3. Upload the thumb back at a deterministic suffix.
  const thumbKey = `${photo.r2Key}.thumb.webp`;
  await r2.send(
    new PutObjectCommand({
      Bucket: r2Bucket,
      Key: thumbKey,
      Body: thumbBuf,
      ContentType: 'image/webp',
    }),
  );

  // 4. Persist dimensions + thumb URL.
  await prisma.photo.update({
    where: { id: photoId },
    data: {
      thumbUrl: `${r2PublicUrl}/${thumbKey}`,
      width: meta.width ?? null,
      height: meta.height ?? null,
      bytes: buffer.length,
    },
  });

  return { thumbKey, width: meta.width, height: meta.height };
};
