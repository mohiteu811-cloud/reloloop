import type { Processor } from 'bullmq';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { r2, r2Bucket, r2PublicUrlFor } from '../../lib/r2';
import { prisma } from '../../lib/prisma';

export type PhotoPostprocessJob = { photoId: string };

// Carryover-equivalent of LivAround's image-postprocess worker:
// download original, generate a 480px WebP thumbnail (honoring
// EXIF rotation), upload back to R2, persist dimensions + thumb URL.
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

  // 2. Apply EXIF rotation to a buffer first so `metadata` reflects
  // the auto-oriented dimensions.
  const { data: rotatedData, info: rotatedInfo } = await sharp(buffer, {
    failOn: 'truncated',
  })
    .rotate()
    .toBuffer({ resolveWithObject: true });

  // 3. Generate the 480px WebP thumbnail from the rotated buffer.
  const thumbBuf = await sharp(rotatedData)
    .resize({ width: 480, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  // 4. Upload the thumb back at a deterministic suffix.
  const thumbKey = `${photo.r2Key}.thumb.webp`;
  await r2.send(
    new PutObjectCommand({
      Bucket: r2Bucket,
      Key: thumbKey,
      Body: thumbBuf,
      ContentType: 'image/webp',
    }),
  );

  // 5. Persist post-rotation dimensions + thumb URL. r2PublicUrlFor
  // throws if R2_PUBLIC_BASE_URL is unset so we never silently
  // write a broken `/key` URL into the DB.
  await prisma.photo.update({
    where: { id: photoId },
    data: {
      thumbUrl: r2PublicUrlFor(thumbKey),
      width: rotatedInfo.width,
      height: rotatedInfo.height,
      bytes: buffer.length,
    },
  });

  return { thumbKey, width: rotatedInfo.width, height: rotatedInfo.height };
};
