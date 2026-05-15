import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma, withSerializableRetry } from '@/lib/prisma';
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
// Confirms a client-side R2 upload. Atomic: status check + photo
// upsert run inside a serializable transaction so a concurrent
// publish can't slip a row into a frozen listing, and a retried
// confirm (mobile network blip after upload-success) is a no-op
// instead of a duplicate row + duplicate processing job.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

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

  type Outcome =
    | { kind: 'ok'; photo: Awaited<ReturnType<typeof prisma.photo.findUnique>> }
    | { kind: 'not_found' }
    | { kind: 'forbidden' }
    | { kind: 'invalid_status'; currentStatus: string };

  // Serializable interactive txn so the status check + upsert are
  // atomic. Retry on P2034 (serialization conflict) because Prisma
  // expects the application to handle that class at this isolation
  // level; without retry, two healthy concurrent confirms can 500.
  const outcome = await withSerializableRetry<Outcome>(() =>
    prisma.$transaction(
      async (tx): Promise<Outcome> => {
        const listing = await tx.listing.findUnique({
          where: { id },
          select: {
            status: true,
            user: { select: { email: true } },
          },
        });
        if (!listing) return { kind: 'not_found' };
        if (listing.user.email !== session.user!.email) {
          return { kind: 'forbidden' };
        }
        if (listing.status !== 'DRAFT' && listing.status !== 'PROCESSING') {
          return { kind: 'invalid_status', currentStatus: listing.status };
        }
        const photo = await tx.photo.upsert({
          where: {
            listingId_r2Key: { listingId: id, r2Key: parsed.data.r2Key },
          },
          create: {
            listingId: id,
            r2Key: parsed.data.r2Key,
            url: `${r2PublicUrl}/${parsed.data.r2Key}`,
            bytes: parsed.data.bytes,
            // sortOrder stays at default 0; gallery order falls
            // through to uploadedAt asc as the deterministic
            // tiebreaker. Avoids the race a count()-derived
            // sortOrder would create under parallel uploads.
          },
          update: {},
        });
        return { kind: 'ok', photo };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  if (outcome.kind === 'not_found') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (outcome.kind === 'forbidden') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (outcome.kind === 'invalid_status') {
    return NextResponse.json(
      { error: 'invalid_status', currentStatus: outcome.currentStatus },
      { status: 409 },
    );
  }

  // Worker handler is internally idempotent (overwrites thumb + dims),
  // so re-enqueueing on retry is wasteful but correct.
  await photoPostprocessQueue.add('process', { photoId: outcome.photo!.id });

  return NextResponse.json({ photo: outcome.photo }, { status: 201 });
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
    // sortOrder is the manual-override (defaults to 0 for all photos
    // until a reorder UI lands); uploadedAt is the deterministic
    // tiebreaker so the gallery stays stable.
    orderBy: [{ sortOrder: 'asc' }, { uploadedAt: 'asc' }],
  });
  return NextResponse.json({ photos });
}
