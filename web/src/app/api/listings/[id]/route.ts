import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { updateListingSchema } from '@/lib/listings';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await auth();
  const listing = await prisma.listing.findUnique({
    where: { id },
    include: {
      category: true,
      originCity: true,
      wantedCity: true,
      photos: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
  if (!listing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const isOwner =
    !!session?.user?.email && listing.user.email === session.user.email;
  if (!isOwner && listing.status !== 'LIVE') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  if (!isOwner) {
    // Strip owner-only fields. visibleDefects in particular is an
    // AI hint surfaced on the review screen for the owner to decide
    // whether to mention in their description — leaking it via the
    // public API would surface defects the owner deliberately chose
    // not to disclose. user.email is also owner-only.
    const { user, visibleDefects: _defects, ...publicListing } = listing;
    void _defects;
    return NextResponse.json({
      listing: { ...publicListing, user: { id: user.id, name: user.name } },
    });
  }
  return NextResponse.json({ listing });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = updateListingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid', issues: parsed.error.issues },
      { status: 422 },
    );
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
  if (d.availableUntilISO !== undefined) data.availableUntil = new Date(d.availableUntilISO);

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: 'no_fields_to_update' },
      { status: 422 },
    );
  }

  try {
    const result = await prisma.listing.updateMany({
      where: { id, user: { email: session.user.email } },
      data,
    });
    if (result.count === 0) {
      const exists = await prisma.listing.findUnique({
        where: { id },
        select: { id: true },
      });
      return NextResponse.json(
        { error: exists ? 'forbidden' : 'not_found' },
        { status: exists ? 403 : 404 },
      );
    }
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2003'
    ) {
      return NextResponse.json(
        {
          error: 'invalid_reference',
          field: (err.meta as { field_name?: string } | undefined)?.field_name,
        },
        { status: 422 },
      );
    }
    throw err;
  }

  const updated = await prisma.listing.findUnique({ where: { id } });
  return NextResponse.json({ listing: updated });
}
