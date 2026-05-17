import { signIn } from '@/lib/auth';

export default function SignIn() {
  async function action(formData: FormData) {
    'use server';
    await signIn('resend', formData);
  }
  return (
    <main style={{ maxWidth: 480, margin: '64px auto', padding: '0 24px' }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Sign in to LivinLoop</h1>
      <p style={{ color: '#555', marginBottom: 24 }}>
        We&apos;ll email you a magic link.
      </p>
      <form action={action} style={{ display: 'flex', gap: 8 }}>
        <input
          type="email"
          name="email"
          placeholder="you@example.com"
          required
          style={{
            flex: 1,
            padding: 12,
            fontSize: 16,
            border: '1px solid #ccc',
            borderRadius: 6,
          }}
        />
        <button
          type="submit"
          style={{
            padding: '12px 20px',
            fontSize: 16,
            background: '#111',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Send link
        </button>
      </form>
    </main>
  );
}
