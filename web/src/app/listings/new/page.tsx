import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export default async function NewListing() {
  const session = await auth();
  if (!session?.user?.email) redirect('/signin');

  const [cities, categories] = await Promise.all([
    prisma.city.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.itemCategory.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
  ]);

  async function createListing(formData: FormData) {
    'use server';
    const session = await auth();
    if (!session?.user?.email) throw new Error('unauthorized');
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: session.user.email },
    });

    const listing = await prisma.listing.create({
      data: {
        userId: user.id,
        title: String(formData.get('title') ?? '').trim(),
        description: String(formData.get('description') ?? '').trim() || null,
        categoryId: String(formData.get('categoryId')),
        condition: String(formData.get('condition')) as
          | 'LIKE_NEW'
          | 'GOOD'
          | 'USED'
          | 'WORN',
        askingValueCents: Math.round(
          Number(formData.get('askingValueDollars') ?? 0) * 100,
        ),
        originCityId: String(formData.get('originCityId')),
        wantedCityId: String(formData.get('wantedCityId')),
        availableUntil: new Date(String(formData.get('availableUntil'))),
        status: 'DRAFT',
      },
    });

    redirect(`/listings/${listing.id}`);
  }

  return (
    <main style={{ maxWidth: 640, margin: '32px auto', padding: '0 24px' }}>
      <h1 style={{ fontSize: 28 }}>New listing</h1>
      <form
        action={createListing}
        style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}
      >
        <Field label="Title">
          <input
            name="title"
            required
            maxLength={80}
            style={inputStyle}
            placeholder="IKEA SÖDERHAMN 3-seat couch, light grey"
          />
        </Field>
        <Field label="Description (optional)">
          <textarea name="description" rows={3} style={{ ...inputStyle, fontFamily: 'inherit' }} />
        </Field>
        <Field label="Category">
          <select name="categoryId" required style={inputStyle}>
            <option value="">Select…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Condition">
          <select name="condition" required style={inputStyle}>
            <option value="LIKE_NEW">Like new</option>
            <option value="GOOD">Good</option>
            <option value="USED">Used</option>
            <option value="WORN">Worn</option>
          </select>
        </Field>
        <Field label="Asking value (NZD)">
          <input
            name="askingValueDollars"
            type="number"
            step="1"
            min="1"
            required
            style={inputStyle}
          />
        </Field>
        <Row>
          <Field label="Where the item is">
            <select name="originCityId" required style={inputStyle}>
              <option value="">Select…</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Where you're moving to">
            <select name="wantedCityId" required style={inputStyle}>
              <option value="">Select…</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </Row>
        <Field label="Available until">
          <input name="availableUntil" type="date" required style={inputStyle} />
        </Field>
        <button
          type="submit"
          style={{
            marginTop: 12,
            padding: '12px 24px',
            background: '#111',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 16,
          }}
        >
          Create draft
        </button>
      </form>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  padding: 10,
  fontSize: 15,
  border: '1px solid #ccc',
  borderRadius: 6,
  width: '100%',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 13, color: '#555' }}>{label}</span>
      {children}
    </label>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{children}</div>
  );
}
