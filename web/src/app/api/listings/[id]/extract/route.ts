import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { listingAutofillQueue } from '@/lib/queues';

export const runtime = 'nodejs';

// POST /api/listings/:id/extract
// Enqueues a `listing-autofill` job. Owner-only, requires at
// least one photo, only valid in DRAFT / PROCESSING.
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

  // Deterministic jobId dedupes rapid double-clicks while a job is
  // in flight. removeOnComplete: true / removeOnFail: true evict
  // eagerly on job lifecycle events, not via age-based lazy sweeps
  // (which never trigger on a low-traffic queue and would keep the
  // jobId stuck indefinitely, silently blocking re-runs). Detailed
  // failure history stays in worker stdout.
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

  return NextResponse.json({ enqueued: true });
}
