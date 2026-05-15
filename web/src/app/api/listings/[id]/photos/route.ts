import { NextRequest, NextResponse } from 'next/server';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma, withSerializableRetry } from '@/lib/prisma';
import { r2, r2Bucket, r2PublicUrl } from '@/lib/r2';
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

  if (!parsed.data.r2Key.startsWith(`listings/${id}/`)) {
    return NextResponse.json({ error: 'invalid_key' }, { status: 422 });
  }

  // Verify the upload actually landed in R2 before creating the
  // Photo row. Prevents crafted confirms with never-uploaded keys.
  try {
    await r2.send(
      new HeadObjectCommand({
        Bucket: r2Bucket,
        Key: parsed.data.r2Key,
      }),
    );
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'NotFound' || name === 'NoSuchKey') {
      return NextResponse.json(
        {
          error: 'object_not_found',
          message: 'No upload found at the supplied r2Key.',
        },
        { status: 404 },
      );
    }
    console.error('[photo:confirm] HeadObject failed', err);
    return NextResponse.json({ error: 'r2_unavailable' }, { status: 503 });
  }

  type Outcome =
    | { kind: 'ok'; photo: Awaited<ReturnType<typeof prisma.photo.findUnique>> }
    | { kind: 'not_found' }
    | { kind: 'forbidden' }
    | { kind: 'invalid_status'; currentStatus: string };

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

  // Deterministic jobId keyed on photoId so a retried confirm
  // doesn't create a duplicate postprocess job. Short retention
  // (60s on completion, 5min on failure) bounds the dedupe window
  // to the typical retry burst while letting a deliberate manual
  // re-process succeed after that. The jobId uses `-` not `:` —
  // BullMQ 5.x rejects `:` in queue keys.
  await photoPostprocessQueue.add(
    'process',
    { photoId: outcome.photo!.id },
    {
      jobId: `photo-${outcome.photo!.id}`,
      removeOnComplete: { age: 60, count: 1000 },
      removeOnFail: { age: 60 * 5, count: 1000 },
    },
  );

  return NextResponse.json({ photo: outcome.photo }, { status: 201 });
}

// GET /api/listings/:id/photos
// Same visibility rule as GET /api/listings/:id: owner sees any
// status, non-owners only see LIVE. DB-only.
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
    orderBy: [{ sortOrder: 'asc' }, { uploadedAt: 'asc' }],
  });
  return NextResponse.json({ photos });
}
