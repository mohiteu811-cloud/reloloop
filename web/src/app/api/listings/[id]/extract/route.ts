import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { listingAutofillQueue } from '@/lib/queues';

export const runtime = 'nodejs';

// POST /api/listings/:id/extract
//
// Triggers an AI extraction job. Status flow:
//   DRAFT (with photos) --[atomic flip]--> PROCESSING --[worker]--> DRAFT
//
// Locking the listing in PROCESSING for the duration of the
// worker's run keeps user edits + the AI write from racing each
// other. Every other owner action (edit page, photo upload/delete,
// re-extract) gates on DRAFT, so PROCESSING really means "hands
// off, AI is working".
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  // Atomic DRAFT -> PROCESSING flip with ownership + photos guards.
  // If count===0 we re-read to surface the specific reason.
  const flip = await prisma.listing.updateMany({
    where: {
      id,
      user: { email: session.user.email },
      status: 'DRAFT',
      photos: { some: {} },
    },
    data: { status: 'PROCESSING' },
  });

  if (flip.count === 0) {
    const existing = await prisma.listing.findUnique({
      where: { id },
      select: {
        status: true,
        user: { select: { email: true } },
        _count: { select: { photos: true } },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (existing.user.email !== session.user.email) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    if (existing.status !== 'DRAFT') {
      return NextResponse.json(
        { error: 'invalid_status', currentStatus: existing.status },
        { status: 409 },
      );
    }
    if (existing._count.photos === 0) {
      return NextResponse.json(
        {
          error: 'no_photos',
          message: 'Upload at least one photo before running AI extraction.',
        },
        { status: 422 },
      );
    }
    return NextResponse.json({ error: 'unknown' }, { status: 500 });
  }

  try {
    await listingAutofillQueue.add(
      'extract',
      { listingId: id },
      {
        jobId: `extract-${id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  } catch (err) {
    // Don't leave the listing stuck in PROCESSING if Redis is down
    // or the enqueue otherwise fails. Best-effort revert.
    await prisma.listing
      .updateMany({
        where: { id, status: 'PROCESSING' },
        data: { status: 'DRAFT' },
      })
      .catch((revertErr) => {
        console.error(
          `[extract] could not revert ${id} from PROCESSING after enqueue failure`,
          revertErr,
        );
      });
    throw err;
  }

  return NextResponse.json({ enqueued: true });
}
