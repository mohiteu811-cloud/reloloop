import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

// Allowed source statuses for a withdraw. PROPOSED and LOCKED are
// excluded because withdrawing during an active swap proposal needs
// to cascade into the proposal / fee / conversation state (handled
// in M5/M6). SWAPPED and WITHDRAWN are terminal.
const WITHDRAWABLE = ['DRAFT', 'LIVE'] as const;

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  // Single atomic conditional write — same pattern as publish.
  // No read-then-write race; concurrent transitions to a terminal
  // state can't be overwritten back to WITHDRAWN.
  const result = await prisma.listing.updateMany({
    where: {
      id,
      user: { email: session.user.email },
      status: { in: [...WITHDRAWABLE] },
    },
    data: { status: 'WITHDRAWN' },
  });

  if (result.count === 0) {
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
