import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

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
    },
  });
  if (!listing) notFound();

  const isOwner = listing.user.email === session.user.email;

  async function publish() {
    'use server';
    await prisma.listing.update({
      where: { id },
      data: { status: 'LIVE', publishedAt: new Date() },
    });
  }

  async function withdraw() {
    'use server';
    await prisma.listing.update({
      where: { id },
      data: { status: 'WITHDRAWN' },
    });
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
        <dt style={{ color: '#888' }}>Condition</dt>
        <dd style={{ margin: 0 }}>{listing.condition}</dd>
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
      {isOwner && (
        <div style={{ marginTop: 32, display: 'flex', gap: 12 }}>
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
      )}
    </main>
  );
}
