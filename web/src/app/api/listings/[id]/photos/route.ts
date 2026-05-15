import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { r2PublicUrl } from '@/lib/r2';
import { photoPostprocessQueue } from '@/lib/queues';

export const runtime = 'nodejs';

const confirmSchema = z.object({
  r2Key: z.string().min(1).max(512),
  bytes: z
    .number()
    .int()
    .min(1)
    .max(15 * 1024 * 1024),
});

// POST /api/listings/:id/photos
// Confirms a client-side R2 upload by creating the Photo row and
// enqueueing `photo:postprocess` (sharp thumbnail + dimensions).
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
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  // Defense in depth: the r2Key must live under the listing's prefix
  // so a crafted confirm can't attach an existing R2 object from
  // another listing.
  if (!parsed.data.r2Key.startsWith(`listings/${id}/`)) {
    return NextResponse.json({ error: 'invalid_key' }, { status: 422 });
  }

  const existingCount = await prisma.photo.count({ where: { listingId: id } });

  const photo = await prisma.photo.create({
    data: {
      listingId: id,
      r2Key: parsed.data.r2Key,
      url: `${r2PublicUrl}/${parsed.data.r2Key}`,
      bytes: parsed.data.bytes,
      sortOrder: existingCount,
    },
  });

  // Fire-and-forget enqueue. The worker fills in thumbUrl + width
  // + height. Photo row is usable for ordering / listing card art
  // even before postprocess runs.
  await photoPostprocessQueue.add('process', { photoId: photo.id });

  return NextResponse.json({ photo }, { status: 201 });
}

// GET /api/listings/:id/photos
// Same visibility rule as GET /api/listings/:id: owner sees any
// status, non-owners only see LIVE.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const { id } = await ctx.params;
  const listing = await prisma.listing.findUnique({
    where: { id },
    select: { status: true, user: { select: { email: true } } },
  });
  if (!listing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const isOwner =
    !!session?.user?.email && listing.user.email === session.user.email;
  if (!isOwner && listing.status !== 'LIVE') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const photos = await prisma.photo.findMany({
    where: { listingId: id },
    orderBy: { sortOrder: 'asc' },
  });
  return NextResponse.json({ photos });
}
