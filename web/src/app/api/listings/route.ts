import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createListingSchema } from '@/lib/listings';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = createListingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const d = parsed.data;
  try {
    const listing = await prisma.listing.create({
      data: {
        userId: user.id,
        title: d.title,
        description: d.description,
        categoryId: d.categoryId,
        condition: d.condition,
        brand: d.brand,
        model: d.model,
        ageYears: d.ageYears,
        widthCm: d.widthCm,
        depthCm: d.depthCm,
        heightCm: d.heightCm,
        askingValueCents: d.askingValueCents,
        originCityId: d.originCityId,
        wantedCityId: d.wantedCityId,
        wantedNotes: d.wantedNotes,
        availableUntil: new Date(d.availableUntilISO),
        status: 'DRAFT',
      },
    });
    return NextResponse.json({ listing }, { status: 201 });
  } catch (err) {
    // P2003 = foreign-key constraint failure (bogus categoryId,
    // originCityId, or wantedCityId). zod can't catch this because
    // it doesn't know which IDs are valid — only the DB does.
    // Surface as 422 instead of leaking a 500.
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
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const listings = await prisma.listing.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    include: {
      category: { select: { name: true, slug: true } },
      originCity: { select: { name: true, slug: true } },
      wantedCity: { select: { name: true, slug: true } },
    },
  });

  return NextResponse.json({ listings });
}
