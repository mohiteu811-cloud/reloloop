import Link from 'next/link';
import { auth } from '@/lib/auth';

export default async function Page() {
  const session = await auth();
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>LivinLoop</h1>
      <p style={{ color: '#555' }}>
        Swap-first marketplace. v0.1.0 — M1: auth, seed, manual listing CRUD.
      </p>
      <div style={{ marginTop: 32 }}>
        {session?.user ? (
          <Link
            href="/listings"
            style={{
              padding: '10px 20px',
              background: '#111',
              color: '#fff',
              borderRadius: 6,
              textDecoration: 'none',
            }}
          >
            Your listings
          </Link>
        ) : (
          <Link
            href="/signin"
            style={{
              padding: '10px 20px',
              background: '#111',
              color: '#fff',
              borderRadius: 6,
              textDecoration: 'none',
            }}
          >
            Sign in
          </Link>
        )}
      </div>
    </main>
  );
}
