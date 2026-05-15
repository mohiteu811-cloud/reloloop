import { S3Client } from '@aws-sdk/client-s3';

// R2 is S3-compatible. Region is always "auto" for R2.
const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

export const r2Bucket = process.env.R2_BUCKET ?? '';
const r2PublicBaseUrlRaw = process.env.R2_PUBLIC_BASE_URL ?? '';

// Don't throw at module load — unrelated routes (auth, health,
// listings without photos) shouldn't crash if R2 isn't configured
// in dev. Runtime calls fail with a clearer AWS SDK error.
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

// Backwards-compat export for callers that don't need URL-building.
export const r2PublicUrl = r2PublicBaseUrlRaw;

// Use this in any path that PERSISTS a public photo URL (confirm,
// postprocess). Throws when R2_PUBLIC_BASE_URL is empty so a
// misconfigured deploy can't quietly write rows pointing at
// `/listings/...` (which would render as broken images in the UI
// and never recover without a manual DB fix).
export function r2PublicUrlFor(key: string): string {
  if (!r2PublicBaseUrlRaw) {
    throw new Error(
      'R2_PUBLIC_BASE_URL is not configured — cannot build a public ' +
        'photo URL. Set it on the web and worker services (e.g., ' +
        'https://cdn.livinloop.com).',
    );
  }
  return `${r2PublicBaseUrlRaw}/${key}`;
}
