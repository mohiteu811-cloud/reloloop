import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

// GET /api/listings/:id/matches
//
// Owner-only — the schema's match flow is "the user opens their own
// listing's detail page and sees a 'Possible swaps' section"
// (§4.3), so non-owners shouldn't poke this endpoint for matches
// on listings they don't own.
//
// Returns the top-K SwapMatch rows ranked by overallScore, with a
// trimmed view of each match's other listing (title, lead photo,
// asking value, both cities, owner first name). geographyText is
// server-rendered so the copy stays consistent across email / push /
// in-app surfaces per the schema's note in §6.8.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  const me = await prisma.listing.findUnique({
    where: { id },
    select: {
      originCity: { select: { slug: true, name: true } },
      wantedCity: { select: { slug: true, name: true } },
      user: { select: { email: true } },
    },
  });
  if (!me) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (me.user.email !== session.user.email) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const matches = await prisma.swapMatch.findMany({
    where: { listingAId: id },
    orderBy: { overallScore: 'desc' },
    take: 20,
    include: {
      listingB: {
        select: {
          id: true,
          title: true,
          askingValueCents: true,
          status: true,
          originCity: { select: { slug: true, name: true } },
          wantedCity: { select: { slug: true, name: true } },
          photos: {
            orderBy: [{ sortOrder: 'asc' }, { uploadedAt: 'asc' }],
            take: 1,
            select: { thumbUrl: true, url: true },
          },
          user: { select: { name: true } },
        },
      },
    },
  });

  const formatted = matches
    // Skip pairs where the other side has transitioned out of LIVE
    // since the SwapMatch row was last written. (Nightly cron will
    // clean these up; this filter keeps the live UI honest in the
    // meantime.)
    .filter((m) => m.listingB.status === 'LIVE')
    .map((m) => {
      const isBilateral = m.geographyScore >= 0.99;
      const ownerFirst =
        (m.listingB.user.name ?? '').split(/\s+/)[0] || 'Someone';
      const geographyText = isBilateral
        ? `${ownerFirst} is moving ${m.listingB.originCity.name} → ${m.listingB.wantedCity.name}. You're moving ${me.originCity.name} → ${me.wantedCity.name}.`
        : `Also in ${m.listingB.originCity.name}.`;
      return {
        matchId: m.id,
        listing: {
          id: m.listingB.id,
          title: m.listingB.title,
          thumbUrl:
            m.listingB.photos[0]?.thumbUrl ?? m.listingB.photos[0]?.url ?? null,
          askingValueCents: m.listingB.askingValueCents,
          originCity: m.listingB.originCity,
          wantedCity: m.listingB.wantedCity,
          owner: { firstName: ownerFirst },
        },
        scores: {
          // The schema §6.8 note: value score is internal-only, not
          // surfaced. We include it in the API for the owner since
          // they can see their own data, but the UI doesn't render it.
          semantic: m.semanticScore,
          value: m.valueScore,
          geography: m.geographyScore,
          overall: m.overallScore,
        },
        geographyFraming: isBilateral ? 'BILATERAL_INTERCITY' : 'SAME_CITY',
        geographyText,
      };
    });

  return NextResponse.json({ listingId: id, matches: formatted });
}
