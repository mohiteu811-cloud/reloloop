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

  // 2. Apply EXIF rotation to a buffer first — sharp's `metadata()`
  // reads from the source and ignores pipeline transforms, so we
  // need an already-rotated buffer to get correct portrait/landscape
  // dimensions. Without this, an iPhone portrait photo would persist
  // swapped width/height even though the thumb is correctly oriented.
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

  // 5. Persist post-rotation dimensions + thumb URL.
  await prisma.photo.update({
    where: { id: photoId },
    data: {
      thumbUrl: `${r2PublicUrl}/${thumbKey}`,
      width: rotatedInfo.width,
      height: rotatedInfo.height,
      bytes: buffer.length,
    },
  });

  return { thumbKey, width: rotatedInfo.width, height: rotatedInfo.height };
};
