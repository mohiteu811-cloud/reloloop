import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { presignUpload } from '@/lib/r2-presign';

export const runtime = 'nodejs';

// HEIC is intentionally excluded: sharp's default prebuilt
// binaries don't decode HEIC, so a successful upload would fail
// in the worker. iPhone uploads need to be converted to JPEG
// client-side (expo-image-manipulator does this) before calling
// /presign.
const presignSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(15 * 1024 * 1024), // 15MB cap
});

// POST /api/listings/:id/photos/presign
// Returns a presigned PUT URL the client uploads the raw photo to.
// We don't create a Photo row here — if the client never finishes
// the upload + confirm round-trip, the R2 object stays orphaned and
// the bucket's lifecycle policy cleans it up.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const listing = await prisma.listing.findUnique({
    where: { id },
    select: { status: true, user: { select: { email: true } } },
  });
  if (!listing) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (listing.user.email !== session.user.email) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  // Photos can only be added while the listing is being prepared
  // (DRAFT) or actively processed (PROCESSING, e.g. mid-AI-extract).
  // Once LIVE/PROPOSED/LOCKED/SWAPPED/WITHDRAWN, the photo set is
  // frozen.
  if (listing.status !== 'DRAFT' && listing.status !== 'PROCESSING') {
    return NextResponse.json(
      { error: 'invalid_status', currentStatus: listing.status },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = presignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  const ext = extMap[parsed.data.contentType];
  const r2Key = `listings/${id}/${crypto.randomUUID()}.${ext}`;
  const { uploadUrl, expiresIn } = await presignUpload({
    key: r2Key,
    contentType: parsed.data.contentType,
    maxBytes: parsed.data.sizeBytes,
  });

  return NextResponse.json({ r2Key, uploadUrl, expiresIn });
}
