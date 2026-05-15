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
  // exists, the caller owns it, AND it's currently DRAFT. No
  // read-then-write race — a concurrent transition can't slip
  // between the check and the update.
  // M1: DRAFT → LIVE directly. M3 inserts PROCESSING in between
  // for AI extraction; M4 gates LIVE on the embedding landing.
  const result = await prisma.listing.updateMany({
    where: {
      id,
      user: { email: session.user.email },
      status: 'DRAFT',
    },
    data: { status: 'LIVE', publishedAt: new Date() },
  });

  if (result.count === 0) {
    // Disambiguate between 404, 403, and 409 with a single read.
    const existing = await prisma.listing.findUnique({
      where: { id },
      select: { status: true, user: { select: { email: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (existing.user.email !== session.user.email) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    return NextResponse.json(
      { error: 'invalid_status', currentStatus: existing.status },
      { status: 409 },
    );
  }

  const updated = await prisma.listing.findUnique({ where: { id } });
  return NextResponse.json({ listing: updated });
}
