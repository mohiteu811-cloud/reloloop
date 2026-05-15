import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { listingAutofillQueue } from '@/lib/queues';

export const runtime = 'nodejs';

// POST /api/listings/:id/extract
// Enqueues a `listing-autofill` job. Owner-only, requires at
// least one photo, only valid in DRAFT / PROCESSING. The worker
// writes results back to the Listing row asynchronously — the
// client polls GET /api/listings/:id to detect completion (the
// `valuationBreakdown` field flips from null to an object).
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  const listing = await prisma.listing.findUnique({
    where: { id },
    select: {
      status: true,
      user: { select: { email: true } },
      _count: { select: { photos: true } },
    },
  });
  if (!listing) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (listing.user.email !== session.user.email) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (listing.status !== 'DRAFT' && listing.status !== 'PROCESSING') {
    return NextResponse.json(
      { error: 'invalid_status', currentStatus: listing.status },
      { status: 409 },
    );
  }
  if (listing._count.photos === 0) {
    return NextResponse.json(
      {
        error: 'no_photos',
        message: 'Upload at least one photo before running AI extraction.',
      },
      { status: 422 },
    );
  }

  await listingAutofillQueue.add(
    'extract',
    { listingId: id },
    {
      // Retry on transient failures (Anthropic rate-limit, network blip).
      // Exponential backoff: 5s, 25s, 125s.
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 60 * 60 * 24 * 7, count: 1000 },
      removeOnFail: { age: 60 * 60 * 24 * 30, count: 5000 },
    },
  );

  return NextResponse.json({ enqueued: true });
}
