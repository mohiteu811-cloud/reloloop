import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export default async function MyListings() {
  const session = await auth();
  if (!session?.user?.email) redirect('/signin');
  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) redirect('/signin');

  const listings = await prisma.listing.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    include: {
      category: { select: { name: true } },
      originCity: { select: { name: true } },
      wantedCity: { select: { name: true } },
    },
  });

  return (
    <main style={{ maxWidth: 720, margin: '32px auto', padding: '0 24px' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <h1 style={{ fontSize: 28, margin: 0 }}>Your listings</h1>
        <Link
          href="/listings/new"
          style={{
            padding: '8px 16px',
            background: '#111',
            color: '#fff',
            borderRadius: 6,
            textDecoration: 'none',
          }}
        >
          New listing
        </Link>
      </header>
      {listings.length === 0 ? (
        <p style={{ color: '#888' }}>No listings yet. Create one to get started.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {listings.map((l) => (
            <li key={l.id} style={{ padding: 16, border: '1px solid #eee', borderRadius: 8 }}>
              <Link href={`/listings/${l.id}`} style={{ color: '#111', textDecoration: 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{l.title}</strong>
                  <span style={{ fontSize: 12, color: '#888' }}>{l.status}</span>
                </div>
                <div style={{ color: '#555', fontSize: 14, marginTop: 4 }}>
                  {l.category.name} · {l.originCity.name} → {l.wantedCity.name} · $
                  {(l.askingValueCents / 100).toFixed(0)} NZD
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
