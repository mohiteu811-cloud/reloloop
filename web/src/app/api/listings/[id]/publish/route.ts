import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  // Single atomic conditional write: only updates if the row
  // exists, the caller owns it, it's currently DRAFT, AND it has
  // at least one photo. The `photos: { some: {} }` predicate stops
  // empty-gallery listings from going LIVE — the marketplace
  // assumes every visible listing has at least one photo for the
  // match card art.
  const result = await prisma.listing.updateMany({
    where: {
      id,
      user: { email: session.user.email },
      status: 'DRAFT',
      photos: { some: {} },
    },
    data: { status: 'LIVE', publishedAt: new Date() },
  });

  if (result.count === 0) {
    // Disambiguate 404 / 403 / 409 / 422 with a single read.
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
    // Shouldn't be reachable, but be loud if it ever is.
    console.error('[publish] unexpected count=0 with all preconditions met', {
      id,
    });
    return NextResponse.json({ error: 'unknown' }, { status: 500 });
  }

  const updated = await prisma.listing.findUnique({ where: { id } });
  return NextResponse.json({ listing: updated });
}
