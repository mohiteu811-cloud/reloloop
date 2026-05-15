import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createListingSchema } from '@/lib/listings';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json();
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
