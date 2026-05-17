import type { Processor } from 'bullmq';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { z } from 'zod';
import {
  anthropic,
  claudeVisionModel,
  ITEM_EXTRACTION_TOOL,
  EXTRACTION_PROMPT,
} from '../../lib/claude';
import { prisma } from '../../lib/prisma';
import { r2, r2Bucket } from '../../lib/r2';
import {
  computeValuation,
  type DepreciationCurve,
} from '../../lib/valuation';

export type ListingAutofillJob = { listingId: string };

const ASKING_VALUE_FLOOR_CENTS = 100;

const extractionSchema = z.object({
  category: z.enum([
    'sofa',
    'fridge',
    'washer',
    'tv',
    'bed',
    'dining',
    'wardrobe',
    'desk',
    'kitchen',
    'rugs',
    'outdoor',
    'other',
  ]),
  brand: z.string().max(80).nullable(),
  model: z.string().max(80).nullable(),
  title: z.string().min(1).max(80),
  condition: z.enum(['LIKE_NEW', 'GOOD', 'USED', 'WORN']),
  estimatedAgeYears: z.number().min(0).max(100),
  widthCm: z.number().min(0).max(1000),
  depthCm: z.number().min(0).max(1000),
  heightCm: z.number().min(0).max(1000),
  visibleDefects: z.array(z.string()).max(20),
  originalRetailEstimateNZD: z.number().min(0).max(1_000_000),
  retailEstimateConfidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  retailEstimateRationale: z.string().min(1).max(500),
});

async function loadPhotoForClaude(r2Key: string): Promise<{
  data: string;
  mediaType: 'image/jpeg';
}> {
  const obj = await r2.send(
    new GetObjectCommand({ Bucket: r2Bucket, Key: r2Key }),
  );
  if (!obj.Body) throw new Error(`r2 object body missing: ${r2Key}`);
  const buf = Buffer.from(await obj.Body.transformToByteArray());

  const compressed = await sharp(buf, { failOn: 'truncated' })
    .rotate()
    .resize({
      width: 1568,
      height: 1568,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();

  return {
    data: compressed.toString('base64'),
    mediaType: 'image/jpeg',
  };
}

export const listingAutofillProcessor: Processor<ListingAutofillJob> = async (
  job,
) => {
  const { listingId } = job.data;

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: {
      photos: { orderBy: { uploadedAt: 'asc' }, take: 4 },
    },
  });
  if (!listing) {
    console.warn(`[listing-autofill] listing ${listingId} not found, skipping`);
    return { skipped: true };
  }
  if (listing.status !== 'DRAFT' && listing.status !== 'PROCESSING') {
    console.warn(
      `[listing-autofill] ${listingId} skipped, status=${listing.status}`,
    );
    return { skipped: true, reason: 'status_changed_before_run' };
  }
  if (listing.photos.length === 0) {
    throw new Error('no_photos');
  }

  const images = await Promise.all(
    listing.photos.map((p) => loadPhotoForClaude(p.r2Key)),
  );

  const response = await anthropic.messages.create({
    model: claudeVisionModel,
    max_tokens: 1024,
    tools: [ITEM_EXTRACTION_TOOL as never],
    tool_choice: { type: 'tool', name: ITEM_EXTRACTION_TOOL.name },
    messages: [
      {
        role: 'user',
        content: [
          ...images.map(
            (img) =>
              ({
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: img.mediaType,
                  data: img.data,
                },
              }),
          ),
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('no_tool_use_in_claude_response');
  }
  const parsed = extractionSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    console.error('[listing-autofill] claude returned invalid shape', {
      issues: parsed.error.issues,
      raw: toolUse.input,
    });
    throw new Error('invalid_extraction_shape');
  }
  const extracted = parsed.data;

  const category = await prisma.itemCategory.findUnique({
    where: { slug: extracted.category },
  });
  if (!category) {
    throw new Error(`category_not_seeded: ${extracted.category}`);
  }

  const breakdown = computeValuation({
    originalRetailCents: Math.round(extracted.originalRetailEstimateNZD * 100),
    retailConfidence: extracted.retailEstimateConfidence,
    retailRationale: extracted.retailEstimateRationale,
    ageYears: extracted.estimatedAgeYears,
    condition: extracted.condition,
    depreciationCurve: category.depreciationCurve as unknown as DepreciationCurve,
  });

  const askingValueCents = Math.max(
    ASKING_VALUE_FLOOR_CENTS,
    breakdown.estimatedValueCents,
  );

  const result = await prisma.listing.updateMany({
    where: {
      id: listingId,
      status: { in: ['DRAFT', 'PROCESSING'] },
    },
    data: {
      categoryId: category.id,
      title: extracted.title,
      brand: extracted.brand,
      model: extracted.model,
      ageYears: extracted.estimatedAgeYears,
      condition: extracted.condition,
      widthCm: Math.round(extracted.widthCm),
      depthCm: Math.round(extracted.depthCm),
      heightCm: Math.round(extracted.heightCm),
      originalRetailCents: breakdown.originalRetailCents,
      estimatedValueCents: breakdown.estimatedValueCents,
      askingValueCents,
      valuationBreakdown: breakdown,
      // M3b: persist AI-noticed defects. UI surfaces them on the
      // review screen so the user can decide whether to add them
      // to the description — not auto-merged.
      visibleDefects: extracted.visibleDefects,
    },
  });

  if (result.count === 0) {
    console.warn(
      `[listing-autofill] ${listingId} skipped persist: status changed during run`,
    );
    return { skipped: true, reason: 'status_changed_during_run' };
  }

  console.log(`[listing-autofill] ${listingId} done`, {
    category: extracted.category,
    title: extracted.title,
    estimatedValueCents: breakdown.estimatedValueCents,
    askingValueCents,
    defects: extracted.visibleDefects,
  });

  return { listingId, estimatedValueCents: breakdown.estimatedValueCents };
};
