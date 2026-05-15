import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// NZ-only in v1 (City.country defaults to 'NZ').
const cities = [
  { slug: 'auckland', name: 'Auckland', lat: -36.8485, lng: 174.7633 },
  { slug: 'wellington', name: 'Wellington', lat: -41.2865, lng: 174.7762 },
  { slug: 'christchurch', name: 'Christchurch', lat: -43.5321, lng: 172.6362 },
  { slug: 'hamilton', name: 'Hamilton', lat: -37.787, lng: 175.2793 },
  { slug: 'tauranga', name: 'Tauranga', lat: -37.6878, lng: 176.1651 },
  { slug: 'dunedin', name: 'Dunedin', lat: -45.8788, lng: 170.5028 },
  { slug: 'queenstown', name: 'Queenstown', lat: -45.0312, lng: 168.6626 },
];

// Curves from reloloop-schema.md §3.3.
// matchToleranceBps: 2000 = ±20%, 2500 = ±25%, 3000 = ±30%, 1500 = ±15%.
const categories = [
  {
    slug: 'sofa',
    name: 'Sofa',
    sortOrder: 1,
    matchToleranceBps: 2500,
    depreciationCurve: { yearOneRetention: 0.55, yearlyDecay: 0.15, floor: 0.1 },
  },
  {
    slug: 'fridge',
    name: 'Fridge',
    sortOrder: 2,
    matchToleranceBps: 1500,
    depreciationCurve: { yearOneRetention: 0.65, yearlyDecay: 0.12, floor: 0.15 },
  },
  {
    slug: 'washer',
    name: 'Washer',
    sortOrder: 3,
    matchToleranceBps: 1500,
    depreciationCurve: { yearOneRetention: 0.6, yearlyDecay: 0.13, floor: 0.15 },
  },
  {
    slug: 'tv',
    name: 'TV',
    sortOrder: 4,
    matchToleranceBps: 2000,
    depreciationCurve: { yearOneRetention: 0.5, yearlyDecay: 0.2, floor: 0.1 },
  },
  {
    slug: 'bed',
    name: 'Bed',
    sortOrder: 5,
    matchToleranceBps: 2500,
    depreciationCurve: { yearOneRetention: 0.45, yearlyDecay: 0.15, floor: 0.1 },
  },
  {
    slug: 'dining',
    name: 'Dining',
    sortOrder: 6,
    matchToleranceBps: 2500,
    depreciationCurve: { yearOneRetention: 0.6, yearlyDecay: 0.1, floor: 0.2 },
  },
  {
    slug: 'wardrobe',
    name: 'Wardrobe',
    sortOrder: 7,
    matchToleranceBps: 2500,
    depreciationCurve: { yearOneRetention: 0.55, yearlyDecay: 0.12, floor: 0.15 },
  },
  {
    slug: 'desk',
    name: 'Desk',
    sortOrder: 8,
    matchToleranceBps: 2500,
    depreciationCurve: { yearOneRetention: 0.55, yearlyDecay: 0.12, floor: 0.15 },
  },
  {
    slug: 'kitchen',
    name: 'Kitchen (small appliances)',
    sortOrder: 9,
    matchToleranceBps: 2500,
    depreciationCurve: { yearOneRetention: 0.5, yearlyDecay: 0.2, floor: 0.1 },
  },
  {
    slug: 'rugs',
    name: 'Rugs & Lighting',
    sortOrder: 10,
    matchToleranceBps: 3000,
    depreciationCurve: { yearOneRetention: 0.55, yearlyDecay: 0.15, floor: 0.15 },
  },
  {
    slug: 'outdoor',
    name: 'Outdoor & BBQ',
    sortOrder: 11,
    matchToleranceBps: 2500,
    depreciationCurve: { yearOneRetention: 0.5, yearlyDecay: 0.18, floor: 0.1 },
  },
  {
    slug: 'other',
    name: 'Other',
    sortOrder: 12,
    matchToleranceBps: 3000,
    depreciationCurve: { yearOneRetention: 0.5, yearlyDecay: 0.15, floor: 0.1 },
  },
];

async function main() {
  for (const c of cities) {
    await prisma.city.upsert({
      where: { slug: c.slug },
      create: { ...c, country: 'NZ' },
      update: c,
    });
  }
  console.log(`[seed] cities: ${cities.length}`);

  for (const cat of categories) {
    await prisma.itemCategory.upsert({
      where: { slug: cat.slug },
      create: cat,
      update: cat,
    });
  }
  console.log(`[seed] categories: ${categories.length}`);
}

main()
  .catch((err) => {
    console.error('[seed] failed', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
