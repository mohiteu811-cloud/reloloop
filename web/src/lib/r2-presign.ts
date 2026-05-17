import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { r2, r2Bucket } from './r2';

export async function presignUpload(opts: {
  key: string;
  contentType: string;
  maxBytes: number;
}): Promise<{ uploadUrl: string; expiresIn: number }> {
  // 10-minute window. Long enough for a phone on cellular to upload
  // a 15MB photo; short enough that leaked URLs aren't useful long.
  const expiresIn = 60 * 10;
  const cmd = new PutObjectCommand({
    Bucket: r2Bucket,
    Key: opts.key,
    ContentType: opts.contentType,
    ContentLength: opts.maxBytes,
  });
  const uploadUrl = await getSignedUrl(r2, cmd, { expiresIn });
  return { uploadUrl, expiresIn };
}
