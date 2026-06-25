import type { Processor } from 'bullmq';
import { prisma } from '../../lib/prisma';

export type MatchComputeJob = { listingId: string };

// Only persist SwapMatch rows whose composite score exceeds this
// threshold. From the schema doc §4.2: "persists SwapMatch rows
// where overallScore > 0.6". Configurable via env if we want to
// tune later.
const MATCH_SCORE_THRESHOLD = Number(
  process.env.MATCH_SCORE_THRESHOLD ?? '0.6',
);

type CandidateRow = {
  listingBId: string;
  semanticScore: number;
  valueScore: number;
  geographyScore: number;
  overallScore: number;
};

// match-compute worker. Triggered by listing-embed on completion
// (and from edit flows that change asking value, in a later step).
// Runs the schema's §4.1 SQL: joint constraint on category, value
// tolerance, bilateral-or-same-city geography, cosine-similarity
// over the pgvector embeddings, composite score with the doc's
// 0.4/0.4/0.2 weighting. Upserts SwapMatch rows in BOTH directions
// (A→B and B→A) per §4 so queries from either side find the pair.
export const matchComputeProcessor: Processor<MatchComputeJob> = async (
  job,
) => {
  const { listingId } = job.data;

  const me = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { id: true, status: true, askingValueCents: true },
  });
  if (!me) {
    console.warn(`[match-compute] ${listingId} not found`);
    return { skipped: true };
  }
  if (me.status !== 'LIVE') {
    console.warn(
      `[match-compute] ${listingId} skipped, status=${me.status}`,
    );
    return { skipped: true, reason: 'not_live' };
  }
  if (me.askingValueCents <= 0) {
    // value_score denominator would divide by zero. Guard cheap.
    console.warn(`[match-compute] ${listingId} skipped, asking value 0`);
    return { skipped: true, reason: 'zero_asking' };
  }

  // Candidate query — schema §4.1 verbatim, minus the INSERT (we do
  // the upsert via Prisma client below so SwapMatch ids stay cuids).
  // NULLIF guards a category whose tolerance is configured at 0.
  const candidates = await prisma.$queryRawUnsafe<CandidateRow[]>(
    `
    WITH a AS (
      SELECT l.*, e.vector
      FROM "Listing" l
      JOIN "ListingEmbedding" e ON e."listingId" = l.id
      WHERE l.id = $1
    )
    SELECT
      b.id AS "listingBId",
      (1 - (be.vector <=> a.vector))::float AS "semanticScore",
      GREATEST(0.0, 1.0 - (
        ABS(a."askingValueCents" - b."askingValueCents")::float
        / NULLIF(a."askingValueCents" * (cat."matchToleranceBps" / 10000.0), 0)
      ))::float AS "valueScore",
      (CASE
        WHEN a."originCityId" = b."wantedCityId"
         AND a."wantedCityId" = b."originCityId" THEN 1.0
        WHEN a."originCityId" = b."originCityId"
         AND a."wantedCityId" = b."wantedCityId" THEN 0.5
        ELSE 0.0
      END)::float AS "geographyScore",
      (
        (1 - (be.vector <=> a.vector)) * 0.4
        + GREATEST(0.0, 1.0 - (
            ABS(a."askingValueCents" - b."askingValueCents")::float
            / NULLIF(a."askingValueCents" * (cat."matchToleranceBps" / 10000.0), 0)
          )) * 0.4
        + (CASE
            WHEN a."originCityId" = b."wantedCityId"
             AND a."wantedCityId" = b."originCityId" THEN 1.0
            WHEN a."originCityId" = b."originCityId"
             AND a."wantedCityId" = b."wantedCityId" THEN 0.5
            ELSE 0.0
          END) * 0.2
      )::float AS "overallScore"
    FROM "Listing" b
    JOIN "ListingEmbedding" be ON be."listingId" = b.id
    JOIN "ItemCategory" cat ON cat.id = b."categoryId"
    CROSS JOIN a
    WHERE b.id != a.id
      AND b."categoryId" = a."categoryId"
      AND b."status" = 'LIVE'
      AND b."availableUntil" > NOW()
      AND ABS(b."askingValueCents" - a."askingValueCents")
          < a."askingValueCents" * (cat."matchToleranceBps" / 10000.0)
      AND (
        (b."originCityId" = a."wantedCityId" AND b."wantedCityId" = a."originCityId")
        OR
        (b."originCityId" = a."originCityId" AND b."wantedCityId" = a."wantedCityId")
      )
    ORDER BY "overallScore" DESC
    LIMIT 50
    `,
    listingId,
  );

  // Filter by composite-score threshold. Schema §4.2 uses 0.6.
  const keep = candidates.filter((c) => c.overallScore > MATCH_SCORE_THRESHOLD);

  let writtenA = 0;
  let writtenB = 0;
  for (const c of keep) {
    // A → B (this listing finds B). Identical to B's score because
    // the math is symmetric across the pair (semantic via cosine,
    // value via |delta|/tolerance with same category tolerance,
    // geography lookup symmetric).
    await prisma.swapMatch.upsert({
      where: {
        listingAId_listingBId: { listingAId: listingId, listingBId: c.listingBId },
      },
      create: {
        listingAId: listingId,
        listingBId: c.listingBId,
        semanticScore: c.semanticScore,
        valueScore: c.valueScore,
        geographyScore: c.geographyScore,
        overallScore: c.overallScore,
      },
      update: {
        semanticScore: c.semanticScore,
        valueScore: c.valueScore,
        geographyScore: c.geographyScore,
        overallScore: c.overallScore,
        computedAt: new Date(),
      },
    });
    writtenA++;

    // B → A (so queries from B's detail page also find this pair).
    // Same scores; schema §4 "we still write two rows for query
    // simplicity".
    await prisma.swapMatch.upsert({
      where: {
        listingAId_listingBId: { listingAId: c.listingBId, listingBId: listingId },
      },
      create: {
        listingAId: c.listingBId,
        listingBId: listingId,
        semanticScore: c.semanticScore,
        valueScore: c.valueScore,
        geographyScore: c.geographyScore,
        overallScore: c.overallScore,
      },
      update: {
        semanticScore: c.semanticScore,
        valueScore: c.valueScore,
        geographyScore: c.geographyScore,
        overallScore: c.overallScore,
        computedAt: new Date(),
      },
    });
    writtenB++;
  }

  console.log(`[match-compute] ${listingId} done`, {
    candidates: candidates.length,
    aboveThreshold: keep.length,
    written: writtenA + writtenB,
  });

  return {
    listingId,
    candidates: candidates.length,
    aboveThreshold: keep.length,
  };
};
