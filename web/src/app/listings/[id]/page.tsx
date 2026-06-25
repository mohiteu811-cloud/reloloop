import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { listingEmbedQueue } from '@/lib/queues';
import { PhotoSection } from './photo-section';
import { ExtractButton } from './extract-button';
import type { ValuationBreakdown } from '@/lib/valuation';

export const dynamic = 'force-dynamic';

function parseBreakdown(raw: unknown): ValuationBreakdown | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.originalRetailCents !== 'number' ||
    typeof r.estimatedValueCents !== 'number' ||
    typeof r.depreciationRetention !== 'number' ||
    typeof r.conditionMultiplier !== 'number' ||
    typeof r.ageYears !== 'number' ||
    typeof r.computedAt !== 'string' ||
    typeof r.condition !== 'string' ||
    typeof r.retailConfidence !== 'string' ||
    typeof r.retailRationale !== 'string'
  ) {
    return null;
  }
  return raw as ValuationBreakdown;
}

export default async function ListingDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.email) redirect('/signin');

  const listing = await prisma.listing.findUnique({
    where: { id },
    include: {
      category: true,
      originCity: true,
      wantedCity: true,
      user: { select: { email: true, name: true } },
      photos: {
        orderBy: [{ sortOrder: 'asc' }, { uploadedAt: 'asc' }],
        select: { id: true, url: true, thumbUrl: true },
      },
    },
  });
  if (!listing) notFound();

  const isOwner = listing.user.email === session.user.email;
  if (!isOwner && listing.status !== 'LIVE') notFound();

  const isDraft = listing.status === 'DRAFT';
  const canEditPhotos = isOwner && isDraft;
  const canExtract = isOwner && isDraft;
  const canEditFields = isOwner && isDraft;
  const isProcessing = listing.status === 'PROCESSING';
  const breakdown = parseBreakdown(listing.valuationBreakdown);
  const hasPhotos = listing.photos.length > 0;
  const defects = listing.visibleDefects ?? [];

  // M4 — "Possible swaps". Only meaningful for LIVE listings.
  // We query directly via Prisma rather than fetching the JSON API
  // because we're already a server component; one fewer hop.
  const matches =
    isOwner && listing.status === 'LIVE'
      ? await prisma.swapMatch.findMany({
          where: { listingAId: listing.id },
          orderBy: { overallScore: 'desc' },
          take: 10,
          include: {
            listingB: {
              select: {
                id: true,
                title: true,
                askingValueCents: true,
                status: true,
                originCity: { select: { name: true } },
                wantedCity: { select: { name: true } },
                photos: {
                  orderBy: [{ sortOrder: 'asc' }, { uploadedAt: 'asc' }],
                  take: 1,
                  select: { thumbUrl: true, url: true },
                },
                user: { select: { name: true } },
              },
            },
          },
        })
      : [];
  // Drop pairs where the other side has transitioned out of LIVE
  // since the match row was last written (nightly cron handles
  // proper cleanup).
  const liveMatches = matches.filter((m) => m.listingB.status === 'LIVE');

  async function publish() {
    'use server';
    const s = await auth();
    if (!s?.user?.email) redirect('/signin');
    const flip = await prisma.listing.updateMany({
      where: {
        id,
        user: { email: s.user.email },
        status: 'DRAFT',
        photos: { some: {} },
      },
      data: { status: 'PROCESSING' },
    });
    if (flip.count > 0) {
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
        await prisma.listing
          .updateMany({
            where: { id, status: 'PROCESSING' },
            data: { status: 'DRAFT' },
          })
          .catch(() => {});
        throw err;
      }
    }
    redirect(`/listings/${id}`);
  }

  async function withdraw() {
    'use server';
    const s = await auth();
    if (!s?.user?.email) redirect('/signin');
    await prisma.listing.updateMany({
      where: {
        id,
        user: { email: s.user.email },
        status: { in: ['DRAFT', 'LIVE'] },
      },
      data: { status: 'WITHDRAWN' },
    });
    redirect(`/listings/${id}`);
  }

  return (
    <main style={{ maxWidth: 720, margin: '32px auto', padding: '0 24px' }}>
      <Link href="/listings" style={{ color: '#888', fontSize: 14, textDecoration: 'none' }}>
        ← Your listings
      </Link>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 16,
          marginTop: 16,
        }}
      >
        <div>
          <h1 style={{ fontSize: 28, margin: 0 }}>{listing.title}</h1>
          <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
            Status: {listing.status}
          </div>
        </div>
        {canEditFields && (
          <Link
            href={`/listings/${listing.id}/edit`}
            style={{
              fontSize: 13,
              color: '#5b3df5',
              textDecoration: 'none',
              padding: '6px 12px',
              border: '1px solid #5b3df5',
              borderRadius: 6,
              whiteSpace: 'nowrap',
            }}
          >
            Edit details
          </Link>
        )}
      </header>
      {isProcessing && (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            background: '#eef',
            border: '1px solid #ccd',
            color: '#335',
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          Working on your listing in the background. Edits and uploads are
          paused until this finishes (usually under a minute). The page will
          reflect the new state once it&apos;s ready.
        </div>
      )}
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '4px 24px',
          fontSize: 14,
          marginTop: 16,
        }}
      >
        <dt style={{ color: '#888' }}>Category</dt>
        <dd style={{ margin: 0 }}>{listing.category.name}</dd>
        {listing.brand && (
          <>
            <dt style={{ color: '#888' }}>Brand</dt>
            <dd style={{ margin: 0 }}>{listing.brand}</dd>
          </>
        )}
        {listing.model && (
          <>
            <dt style={{ color: '#888' }}>Model</dt>
            <dd style={{ margin: 0 }}>{listing.model}</dd>
          </>
        )}
        <dt style={{ color: '#888' }}>Condition</dt>
        <dd style={{ margin: 0 }}>{listing.condition}</dd>
        {listing.ageYears !== null && (
          <>
            <dt style={{ color: '#888' }}>Age</dt>
            <dd style={{ margin: 0 }}>{listing.ageYears} years</dd>
          </>
        )}
        {(listing.widthCm || listing.depthCm || listing.heightCm) && (
          <>
            <dt style={{ color: '#888' }}>Dimensions</dt>
            <dd style={{ margin: 0 }}>
              {listing.widthCm ?? '?'} × {listing.depthCm ?? '?'} ×{' '}
              {listing.heightCm ?? '?'} cm
            </dd>
          </>
        )}
        <dt style={{ color: '#888' }}>Asking value</dt>
        <dd style={{ margin: 0 }}>${(listing.askingValueCents / 100).toFixed(2)} NZD</dd>
        <dt style={{ color: '#888' }}>From</dt>
        <dd style={{ margin: 0 }}>{listing.originCity.name}</dd>
        <dt style={{ color: '#888' }}>Moving to</dt>
        <dd style={{ margin: 0 }}>{listing.wantedCity.name}</dd>
        <dt style={{ color: '#888' }}>Available until</dt>
        <dd style={{ margin: 0 }}>{listing.availableUntil.toISOString().slice(0, 10)}</dd>
      </dl>
      {listing.description && (
        <p style={{ marginTop: 24, lineHeight: 1.5 }}>{listing.description}</p>
      )}

      <PhotoSection
        listingId={listing.id}
        photos={listing.photos}
        canEdit={canEditPhotos}
      />

      {breakdown && <ValuationCard breakdown={breakdown} />}

      {isOwner && defects.length > 0 && (
        <section
          style={{
            marginTop: 24,
            padding: 16,
            background: '#fff8e1',
            border: '1px solid #f0d27a',
            borderRadius: 8,
          }}
        >
          <h2 style={{ fontSize: 16, margin: 0, marginBottom: 4 }}>
            AI noticed in your photos
          </h2>
          <p style={{ fontSize: 12, color: '#7a5d00', margin: '0 0 8px' }}>
            Not auto-applied. Consider mentioning these in your description
            so swap partners know what to expect.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#5d4400' }}>
            {defects.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </section>
      )}

      {isOwner && listing.status === 'LIVE' && (
        <MatchesSection
          matches={liveMatches}
          myOriginCityName={listing.originCity.name}
          myWantedCityName={listing.wantedCity.name}
          myAskingValueCents={listing.askingValueCents}
        />
      )}

      {isOwner && (
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {canExtract && (
            <ExtractButton
              listingId={listing.id}
              hasExtraction={!!breakdown}
              initialComputedAt={breakdown?.computedAt ?? null}
              disabled={!hasPhotos}
              disabledReason={
                hasPhotos ? undefined : 'Upload at least one photo first.'
              }
            />
          )}
          <div style={{ display: 'flex', gap: 12 }}>
            {listing.status === 'DRAFT' && (
              <form action={publish}>
                <button
                  type="submit"
                  disabled={!hasPhotos}
                  title={
                    hasPhotos
                      ? undefined
                      : 'Upload at least one photo before publishing.'
                  }
                  style={{
                    padding: '10px 20px',
                    background: hasPhotos ? '#0a7' : '#888',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: hasPhotos ? 'pointer' : 'not-allowed',
                  }}
                >
                  Publish
                </button>
              </form>
            )}
            {(listing.status === 'DRAFT' || listing.status === 'LIVE') && (
              <form action={withdraw}>
                <button
                  type="submit"
                  style={{
                    padding: '10px 20px',
                    background: '#fff',
                    color: '#900',
                    border: '1px solid #900',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  Withdraw
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function ValuationCard({ breakdown }: { breakdown: ValuationBreakdown }) {
  const retail = breakdown.originalRetailCents / 100;
  const estimate = breakdown.estimatedValueCents / 100;
  const depreciationPct = Math.round((1 - breakdown.depreciationRetention) * 100);
  const conditionPct = Math.round((1 - breakdown.conditionMultiplier) * 100);

  return (
    <section
      style={{
        marginTop: 24,
        padding: 16,
        background: '#f9f9f9',
        border: '1px solid #eee',
        borderRadius: 8,
      }}
    >
      <h2 style={{ fontSize: 16, margin: 0, marginBottom: 4 }}>
        Valuation breakdown
      </h2>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 12 }}>
        AI estimate · confidence:{' '}
        <strong style={{ color: '#444' }}>{breakdown.retailConfidence}</strong>
      </div>
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '4px 24px',
          fontSize: 13,
          margin: 0,
        }}
      >
        <dt style={{ color: '#888' }}>Original retail (est.)</dt>
        <dd style={{ margin: 0 }}>${retail.toFixed(0)} NZD</dd>
        <dt style={{ color: '#888' }}>Age</dt>
        <dd style={{ margin: 0 }}>{breakdown.ageYears} years</dd>
        <dt style={{ color: '#888' }}>Depreciation</dt>
        <dd style={{ margin: 0 }}>
          −{depreciationPct}% · retains {(breakdown.depreciationRetention * 100).toFixed(0)}%
        </dd>
        <dt style={{ color: '#888' }}>Condition: {breakdown.condition}</dt>
        <dd style={{ margin: 0 }}>
          {conditionPct === 0 ? '—' : `−${conditionPct}%`}
        </dd>
      </dl>
      <div style={{ marginTop: 10, fontSize: 11, color: '#888', fontStyle: 'italic' }}>
        {breakdown.retailRationale}
      </div>
      <div
        style={{
          marginTop: 14,
          padding: '10px 12px',
          background: '#fff',
          border: '1px solid #ddd',
          borderRadius: 6,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <strong style={{ fontSize: 14 }}>Estimated value today</strong>
        <strong style={{ fontSize: 18 }}>${estimate.toFixed(2)} NZD</strong>
      </div>
    </section>
  );
}

type MatchRow = {
  id: string;
  semanticScore: number;
  valueScore: number;
  geographyScore: number;
  overallScore: number;
  listingB: {
    id: string;
    title: string;
    askingValueCents: number;
    status: string;
    originCity: { name: string };
    wantedCity: { name: string };
    photos: { thumbUrl: string | null; url: string }[];
    user: { name: string | null };
  };
};

function MatchesSection({
  matches,
  myOriginCityName,
  myWantedCityName,
  myAskingValueCents,
}: {
  matches: MatchRow[];
  myOriginCityName: string;
  myWantedCityName: string;
  myAskingValueCents: number;
}) {
  return (
    <section style={{ marginTop: 32 }}>
      <h2 style={{ fontSize: 18, marginBottom: 4 }}>Possible swaps</h2>
      <p style={{ fontSize: 12, color: '#888', margin: '0 0 12px' }}>
        {matches.length === 0
          ? 'No matches yet. Matches show up when someone in your destination city lists a similar item, or when a same-city swap appears. Check back later — we re-run matches nightly.'
          : 'Ranked by how well your item matches. Asking values shown for each — you decide whether the items feel equivalent enough to swap.'}
      </p>
      {matches.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 12,
          }}
        >
          {matches.map((m) => {
            const isBilateral = m.geographyScore >= 0.99;
            const ownerFirst =
              (m.listingB.user.name ?? '').split(/\s+/)[0] || 'Someone';
            const geographyText = isBilateral
              ? `${ownerFirst} is moving ${m.listingB.originCity.name} → ${m.listingB.wantedCity.name}. You're moving ${myOriginCityName} → ${myWantedCityName}.`
              : `Also in ${m.listingB.originCity.name}.`;
            const photo = m.listingB.photos[0];
            const photoSrc = photo?.thumbUrl ?? photo?.url ?? null;
            const overallPct = Math.round(m.overallScore * 100);
            const deltaCents = m.listingB.askingValueCents - myAskingValueCents;
            const deltaDollars = Math.round(deltaCents / 100);
            const valueText =
              deltaCents === 0
                ? 'Same asking value as yours.'
                : deltaCents > 0
                  ? `Their item is $${Math.abs(deltaDollars)} more than yours.`
                  : `Their item is $${Math.abs(deltaDollars)} less than yours.`;

            return (
              <article
                key={m.id}
                style={{
                  border: '1px solid #eee',
                  borderRadius: 8,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <div style={{ aspectRatio: '4 / 3', background: '#f5f5f5' }}>
                  {photoSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={photoSrc}
                      alt=""
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                  ) : null}
                </div>
                <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      alignItems: 'baseline',
                    }}
                  >
                    <strong style={{ fontSize: 14, lineHeight: 1.3 }}>
                      {m.listingB.title}
                    </strong>
                    <span
                      style={{
                        fontSize: 11,
                        color: '#fff',
                        background: overallPct >= 80 ? '#0a7' : overallPct >= 70 ? '#5b3df5' : '#888',
                        padding: '2px 6px',
                        borderRadius: 4,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {overallPct}% match
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: '#444' }}>
                    ${(m.listingB.askingValueCents / 100).toFixed(0)} NZD
                    <span style={{ color: '#888', marginLeft: 6 }}>· by {ownerFirst}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#666', lineHeight: 1.4 }}>
                    {geographyText}
                  </div>
                  <div style={{ fontSize: 12, color: '#666' }}>{valueText}</div>
                  {/* TODO M5: 'Propose swap' button hits the proposals API. */}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
