import { notFound, redirect } from 'next/navigation';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { updateListingSchema } from '@/lib/listings';

export const dynamic = 'force-dynamic';

const MUTABLE_LISTING_STATUSES = new Set(['DRAFT', 'PROCESSING']);

// Strict YYYY-MM-DD parser. Rejects garbage strings and overflow
// dates like 2026-02-31. Returns ISO datetime at UTC midnight, or null.
function parseCalendarDate(raw: string): string | null {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date.toISOString();
}

// Treat empty form input as null (for nullable columns) so the user
// can clear AI-set values via PATCH. The wrapped Prisma column is
// nullable in the DB schema and the zod schema now accepts null.
function emptyToNull(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function emptyToNullableNumber(v: FormDataEntryValue | null): number | null {
  if (v === null) return null;
  const s = String(v).trim();
  if (s.length === 0) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export default async function EditListing({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; issues?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user?.email) redirect('/signin');

  const [listing, cities, categories] = await Promise.all([
    prisma.listing.findUnique({
      where: { id },
      include: { user: { select: { email: true } } },
    }),
    prisma.city.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.itemCategory.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    }),
  ]);

  if (!listing) notFound();
  // 404 (not 403) for non-owner so listing IDs aren't probeable.
  if (listing.user.email !== session.user.email) notFound();
  if (!MUTABLE_LISTING_STATUSES.has(listing.status)) {
    // LIVE/PROPOSED/LOCKED/SWAPPED/WITHDRAWN — not editable. Bounce
    // back to detail rather than rendering a form the user can't submit.
    redirect(`/listings/${id}`);
  }

  async function updateListing(formData: FormData) {
    'use server';
    const s = await auth();
    if (!s?.user?.email) redirect('/signin');

    const dollarsRaw = Number(formData.get('askingValueDollars') ?? NaN);
    const dateRaw = String(formData.get('availableUntil') ?? '');
    const parsedDate = parseCalendarDate(dateRaw);

    // Build the candidate matching updateListingSchema. Nullable
    // text fields use emptyToNull so an empty input clears them;
    // nullable number fields use emptyToNullableNumber.
    const candidate = {
      title: String(formData.get('title') ?? '').trim(),
      description: emptyToNull(formData.get('description')),
      categoryId: String(formData.get('categoryId') ?? ''),
      condition: String(formData.get('condition') ?? ''),
      brand: emptyToNull(formData.get('brand')),
      model: emptyToNull(formData.get('model')),
      ageYears: emptyToNullableNumber(formData.get('ageYears')),
      widthCm: emptyToNullableNumber(formData.get('widthCm')),
      depthCm: emptyToNullableNumber(formData.get('depthCm')),
      heightCm: emptyToNullableNumber(formData.get('heightCm')),
      askingValueCents: Number.isFinite(dollarsRaw)
        ? Math.round(dollarsRaw * 100)
        : NaN,
      originCityId: String(formData.get('originCityId') ?? ''),
      wantedCityId: String(formData.get('wantedCityId') ?? ''),
      availableUntilISO: parsedDate ?? '',
    };

    const parsed = updateListingSchema.safeParse(candidate);
    if (!parsed.success) {
      const params = new URLSearchParams({
        error: 'invalid_listing',
        issues: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      });
      redirect(`/listings/${id}/edit?${params.toString()}`);
    }

    const d = parsed.data;
    const data: Record<string, unknown> = {};
    if (d.title !== undefined) data.title = d.title;
    if (d.description !== undefined) data.description = d.description;
    if (d.categoryId !== undefined) data.categoryId = d.categoryId;
    if (d.condition !== undefined) data.condition = d.condition;
    if (d.brand !== undefined) data.brand = d.brand;
    if (d.model !== undefined) data.model = d.model;
    if (d.ageYears !== undefined) data.ageYears = d.ageYears;
    if (d.widthCm !== undefined) data.widthCm = d.widthCm;
    if (d.depthCm !== undefined) data.depthCm = d.depthCm;
    if (d.heightCm !== undefined) data.heightCm = d.heightCm;
    if (d.askingValueCents !== undefined) data.askingValueCents = d.askingValueCents;
    if (d.originCityId !== undefined) data.originCityId = d.originCityId;
    if (d.wantedCityId !== undefined) data.wantedCityId = d.wantedCityId;
    if (d.availableUntilISO !== undefined) {
      data.availableUntil = new Date(d.availableUntilISO);
    }

    try {
      const result = await prisma.listing.updateMany({
        where: {
          id,
          user: { email: s.user.email },
          status: { in: ['DRAFT', 'PROCESSING'] },
        },
        data,
      });
      if (result.count === 0) {
        // Lost the race (status transitioned mid-edit) or not the
        // owner anymore. Bounce back to detail; refreshed render
        // tells the user what state the listing is actually in.
        redirect(`/listings/${id}`);
      }
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        const params = new URLSearchParams({
          error: 'invalid_reference',
          issues:
            'A selected city or category is no longer available. Pick another.',
        });
        redirect(`/listings/${id}/edit?${params.toString()}`);
      }
      throw err;
    }

    redirect(`/listings/${id}`);
  }

  const availableUntilDate = listing.availableUntil.toISOString().slice(0, 10);

  return (
    <main style={{ maxWidth: 640, margin: '32px auto', padding: '0 24px' }}>
      <h1 style={{ fontSize: 28 }}>Edit listing</h1>
      <p style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
        Override any field the AI got wrong. Empty fields are cleared.
      </p>
      {sp.error && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: '#fff4f4',
            border: '1px solid #f99',
            color: '#900',
            borderRadius: 6,
            fontSize: 14,
          }}
        >
          <strong>Couldn&apos;t save changes.</strong>
          {sp.issues && <div style={{ marginTop: 4 }}>{sp.issues}</div>}
        </div>
      )}
      <form
        action={updateListing}
        style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}
      >
        <Field label="Title">
          <input
            name="title"
            required
            maxLength={80}
            defaultValue={listing.title}
            style={inputStyle}
          />
        </Field>
        <Field label="Description (optional)">
          <textarea
            name="description"
            rows={3}
            defaultValue={listing.description ?? ''}
            style={{ ...inputStyle, fontFamily: 'inherit' }}
          />
        </Field>
        <Row>
          <Field label="Brand (optional)">
            <input
              name="brand"
              maxLength={80}
              defaultValue={listing.brand ?? ''}
              style={inputStyle}
            />
          </Field>
          <Field label="Model (optional)">
            <input
              name="model"
              maxLength={80}
              defaultValue={listing.model ?? ''}
              style={inputStyle}
            />
          </Field>
        </Row>
        <Field label="Category">
          <select name="categoryId" required defaultValue={listing.categoryId} style={inputStyle}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Condition">
          <select
            name="condition"
            required
            defaultValue={listing.condition}
            style={inputStyle}
          >
            <option value="LIKE_NEW">Like new</option>
            <option value="GOOD">Good</option>
            <option value="USED">Used</option>
            <option value="WORN">Worn</option>
          </select>
        </Field>
        <Field label="Age (years, optional)">
          <input
            name="ageYears"
            type="number"
            step="0.5"
            min="0"
            max="100"
            defaultValue={listing.ageYears ?? ''}
            style={inputStyle}
          />
        </Field>
        <Row>
          <Field label="Width cm">
            <input
              name="widthCm"
              type="number"
              step="1"
              min="0"
              max="1000"
              defaultValue={listing.widthCm ?? ''}
              style={inputStyle}
            />
          </Field>
          <Field label="Depth cm">
            <input
              name="depthCm"
              type="number"
              step="1"
              min="0"
              max="1000"
              defaultValue={listing.depthCm ?? ''}
              style={inputStyle}
            />
          </Field>
          <Field label="Height cm">
            <input
              name="heightCm"
              type="number"
              step="1"
              min="0"
              max="1000"
              defaultValue={listing.heightCm ?? ''}
              style={inputStyle}
            />
          </Field>
        </Row>
        <Field label="Asking value (NZD)">
          <input
            name="askingValueDollars"
            type="number"
            step="1"
            min="1"
            required
            defaultValue={Math.round(listing.askingValueCents / 100)}
            style={inputStyle}
          />
        </Field>
        <Row>
          <Field label="Where the item is">
            <select
              name="originCityId"
              required
              defaultValue={listing.originCityId}
              style={inputStyle}
            >
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Where you're moving to">
            <select
              name="wantedCityId"
              required
              defaultValue={listing.wantedCityId}
              style={inputStyle}
            >
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </Row>
        <Field label="Available until">
          <input
            name="availableUntil"
            type="date"
            required
            defaultValue={availableUntilDate}
            style={inputStyle}
          />
        </Field>
        <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
          <button
            type="submit"
            style={{
              padding: '12px 24px',
              background: '#111',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 16,
            }}
          >
            Save changes
          </button>
          <a
            href={`/listings/${listing.id}`}
            style={{
              padding: '12px 24px',
              background: '#fff',
              color: '#111',
              border: '1px solid #ccc',
              borderRadius: 6,
              textDecoration: 'none',
              fontSize: 16,
            }}
          >
            Cancel
          </a>
        </div>
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
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {children}
    </div>
  );
}
