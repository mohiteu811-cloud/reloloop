import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { listingEmbedQueue } from '@/lib/queues';

export const runtime = 'nodejs';

// POST /api/listings/:id/publish
//
// Status flow per reloloop-schema.md §3.1 step 5:
//   DRAFT (with photos) --[publish]--> PROCESSING --[embed worker]--> LIVE
//
// The atomic flip + enqueue here means the user can't double-publish
// or edit between flip and embed, and every other owner mutation
// (edit page, photo upload/delete, re-extract) gates on DRAFT.
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  // Atomic DRAFT → PROCESSING with ownership + photos guards.
  // publishedAt is NOT set here — the embed worker sets it when
  // the listing actually goes LIVE.
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
          message: 'Upload at least one photo before publishing.',
        },
        { status: 422 },
      );
    }
    return NextResponse.json({ error: 'unknown' }, { status: 500 });
  }

  try {
    await listingEmbedQueue.add(
      'embed',
      { listingId: id },
      {
        jobId: `embed-${id}`,
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
          `[publish] could not revert ${id} from PROCESSING after enqueue failure`,
          revertErr,
        );
      });
    throw err;
  }

  return NextResponse.json({ enqueued: true });
}
