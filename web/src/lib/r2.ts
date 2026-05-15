import { S3Client } from '@aws-sdk/client-s3';

// R2 is S3-compatible. The endpoint URL pattern is:
//   https://<accountId>.r2.cloudflarestorage.com
// Region is always "auto" for R2 — it routes internally.
const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

export const r2Bucket = process.env.R2_BUCKET ?? '';
export const r2PublicUrl =
  process.env.R2_PUBLIC_BASE_URL ?? '';

// Don't throw at module load — web routes that don't touch R2 (like
// /api/health, /signin) shouldn't break when R2 creds are missing
// in local dev. Runtime calls (presign, get, put) will fail with a
// clearer AWS SDK error if the env is incomplete.
export const r2 = new S3Client({
  region: 'auto',
  endpoint: accountId
    ? `https://${accountId}.r2.cloudflarestorage.com`
    : undefined,
  credentials: {
    accessKeyId: accessKeyId ?? '',
    secretAccessKey: secretAccessKey ?? '',
  },
});
