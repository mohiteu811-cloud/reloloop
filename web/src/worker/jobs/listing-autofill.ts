import type { Processor } from 'bullmq';
import { GetObjectCommand } from '@aws-sdk/client-s3';
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

// Defense in depth: the tool's input_schema constrains shape, but
// we re-validate with zod before persisting so a model regression
// or schema drift doesn't poison the DB.
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

const CLAUDE_SUPPORTED_MEDIA = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

async function loadPhotoAsBase64(r2Key: string): Promise<{
  data: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
}> {
  // Fetch from R2 directly via the S3 client. Avoids depending on
  // the bucket being publicly readable, and bypasses any Cloudflare
  // bot-protection that might block Anthropic's URL fetcher.
  const obj = await r2.send(
    new GetObjectCommand({ Bucket: r2Bucket, Key: r2Key }),
  );
  if (!obj.Body) throw new Error(`r2 object body missing: ${r2Key}`);
  const buf = Buffer.from(await obj.Body.transformToByteArray());
  const declaredType = obj.ContentType ?? 'image/jpeg';
  if (!CLAUDE_SUPPORTED_MEDIA.has(declaredType)) {
    throw new Error(
      `unsupported_media_type: ${declaredType} for ${r2Key}`,
    );
  }
  return {
    data: buf.toString('base64'),
    mediaType: declaredType as
      | 'image/jpeg'
      | 'image/png'
      | 'image/webp'
      | 'image/gif',
  };
}

export const listingAutofillProcessor: Processor<ListingAutofillJob> = async (
  job,
) => {
  const { listingId } = job.data;

  // Take up to 4 photos per schema §3.1 step 2 ("Single Gemini call
  // with all 4 photos"). Order by uploadedAt so the user's first
  // upload is the lead image for the prompt.
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
  if (listing.photos.length === 0) {
    throw new Error('no_photos');
  }

  // 1. Load images as base64.
  const images = await Promise.all(
    listing.photos.map((p) => loadPhotoAsBase64(p.r2Key)),
  );

  // 2. Call Claude with forced tool-use for structured output.
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

  // 3. Find the tool_use block and validate its payload.
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

  // 4. Look up the matching ItemCategory (seeded by slug) so we can
  // pull the depreciation curve for valuation.
  const category = await prisma.itemCategory.findUnique({
    where: { slug: extracted.category },
  });
  if (!category) {
    throw new Error(`category_not_seeded: ${extracted.category}`);
  }

  // 5. Run the valuation math.
  const breakdown = computeValuation({
    originalRetailCents: Math.round(extracted.originalRetailEstimateNZD * 100),
    retailConfidence: extracted.retailEstimateConfidence,
    retailRationale: extracted.retailEstimateRationale,
    ageYears: extracted.estimatedAgeYears,
    condition: extracted.condition,
    depreciationCurve: category.depreciationCurve as unknown as DepreciationCurve,
  });

  // 6. Persist results to the Listing row. askingValueCents resets
  // to the new estimate — the user can edit it on the review screen
  // (M3b). visibleDefects isn't persisted in v1 (no column); it
  // surfaces in logs only and will appear in the review screen UI.
  await prisma.listing.update({
    where: { id: listingId },
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
      askingValueCents: breakdown.estimatedValueCents,
      valuationBreakdown: breakdown,
    },
  });

  console.log(`[listing-autofill] ${listingId} done`, {
    category: extracted.category,
    title: extracted.title,
    estimatedValueCents: breakdown.estimatedValueCents,
    defects: extracted.visibleDefects,
  });

  return { listingId, estimatedValueCents: breakdown.estimatedValueCents };
};
