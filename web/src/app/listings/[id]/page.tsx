import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PhotoSection } from './photo-section';
import { ExtractButton } from './extract-button';
import type { ValuationBreakdown } from '@/lib/valuation';

export const dynamic = 'force-dynamic';

// Statuses where the photo set and AI fields are mutable; mirrors
// the API rules in /photos and /extract.
const MUTABLE_LISTING_STATUSES = new Set(['DRAFT', 'PROCESSING']);

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

  const canEditPhotos =
    isOwner && MUTABLE_LISTING_STATUSES.has(listing.status);
  const canExtract =
    isOwner && MUTABLE_LISTING_STATUSES.has(listing.status);
  const breakdown = listing.valuationBreakdown as ValuationBreakdown | null;

  async function publish() {
    'use server';
    const s = await auth();
    if (!s?.user?.email) redirect('/signin');
    await prisma.listing.updateMany({
      where: { id, user: { email: s.user.email }, status: 'DRAFT' },
      data: { status: 'LIVE', publishedAt: new Date() },
    });
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
      <h1 style={{ fontSize: 28, marginTop: 16 }}>{listing.title}</h1>
      <div style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
        Status: {listing.status}
      </div>
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '4px 24px',
          fontSize: 14,
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
        <dd style={{ margin: 0 }}>${(listing.askingValueCents / 100).toFixed(0)} NZD</dd>
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

      {isOwner && (
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {canExtract && (
            <ExtractButton
              listingId={listing.id}
              hasExtraction={!!breakdown}
              disabled={listing.photos.length === 0}
              disabledReason={
                listing.photos.length === 0
                  ? 'Upload at least one photo first.'
                  : undefined
              }
            />
          )}
          <div style={{ display: 'flex', gap: 12 }}>
            {listing.status === 'DRAFT' && (
              <form action={publish}>
                <button
                  type="submit"
                  style={{
                    padding: '10px 20px',
                    background: '#0a7',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
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
        <strong style={{ fontSize: 18 }}>${estimate.toFixed(0)} NZD</strong>
      </div>
    </section>
  );
}
