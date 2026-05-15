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
  const listing = await prisma.listing.findUnique({
    where: { id },
    include: { user: { select: { email: true } } },
  });
  if (!listing) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (listing.user.email !== session.user.email) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (listing.status !== 'DRAFT') {
    return NextResponse.json(
      { error: 'invalid_status', currentStatus: listing.status },
      { status: 409 },
    );
  }

  // M1: no AI extraction, no embedding. Move straight DRAFT → LIVE.
  // M3 adds PROCESSING between DRAFT and LIVE; M4 adds the embed
  // step that flips PROCESSING → LIVE once the CLIP vector lands.
  const updated = await prisma.listing.update({
    where: { id },
    data: { status: 'LIVE', publishedAt: new Date() },
  });

  return NextResponse.json({ listing: updated });
}
