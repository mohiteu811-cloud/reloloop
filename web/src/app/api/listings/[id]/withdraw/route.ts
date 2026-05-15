import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

// Allowed source statuses for a withdraw. PROPOSED and LOCKED are
// excluded because withdrawing during an active swap proposal needs
// to cascade into the proposal / fee / conversation state (handled
// in M5/M6). SWAPPED and WITHDRAWN are terminal.
const WITHDRAWABLE = new Set(['DRAFT', 'LIVE'] as const);

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
    include: { user: { select: { email: true } } },
  });
  if (!listing) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (listing.user.email !== session.user.email) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!WITHDRAWABLE.has(listing.status as 'DRAFT' | 'LIVE')) {
    return NextResponse.json(
      { error: 'invalid_status', currentStatus: listing.status },
      { status: 409 },
    );
  }

  const updated = await prisma.listing.update({
    where: { id },
    data: { status: 'WITHDRAWN' },
  });
  return NextResponse.json({ listing: updated });
}
