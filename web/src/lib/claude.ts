import Anthropic from '@anthropic-ai/sdk';

// Claude client wrapper. Doesn't throw at module load — if the
// key is missing, runtime API calls fail with a clear SDK error
// rather than breaking unrelated routes / the worker boot.
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? '',
});

export const claudeVisionModel =
  process.env.AI_VISION_MODEL ?? 'claude-sonnet-4-6';

// The single-tool / forced-tool-use pattern is how we get reliable
// structured output from Claude. The schema mirrors the prompt in
// reloloop-schema.md §3.1 step 2; if it ever drifts, update both.
export const ITEM_EXTRACTION_TOOL = {
  name: 'submit_item_details',
  description:
    'Submit the extracted item details so the listing can be valued. ' +
    'Use this exactly once per call.',
  input_schema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: [
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
        ],
        description: 'The item’s category. “other” only if nothing fits.',
      },
      brand: {
        type: ['string', 'null'],
        description: 'Best guess of the brand, or null if unknown.',
      },
      model: {
        type: ['string', 'null'],
        description:
          'Model name or product line if visible/identifiable, else null.',
      },
      title: {
        type: 'string',
        maxLength: 80,
        description:
          'Concise listing title, ≤80 chars. Example: ' +
          '“IKEA SÖDERHAMN 3-seat couch, light grey”.',
      },
      condition: {
        type: 'string',
        enum: ['LIKE_NEW', 'GOOD', 'USED', 'WORN'],
      },
      estimatedAgeYears: {
        type: 'number',
        minimum: 0,
        description: 'Best guess of the item’s age in years.',
      },
      widthCm: { type: 'number', minimum: 0 },
      depthCm: { type: 'number', minimum: 0 },
      heightCm: { type: 'number', minimum: 0 },
      visibleDefects: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of observable defects, empty if none.',
      },
      originalRetailEstimateNZD: {
        type: 'number',
        minimum: 0,
        description: 'What this would have cost new at retail, in NZD.',
      },
      retailEstimateConfidence: {
        type: 'string',
        enum: ['LOW', 'MEDIUM', 'HIGH'],
      },
      retailEstimateRationale: {
        type: 'string',
        description:
          'One sentence explaining the retail estimate (e.g. “Based on ' +
          'visible IKEA tag and current SÖDERHAMN pricing”).',
      },
    },
    required: [
      'category',
      'title',
      'condition',
      'estimatedAgeYears',
      'widthCm',
      'depthCm',
      'heightCm',
      'visibleDefects',
      'originalRetailEstimateNZD',
      'retailEstimateConfidence',
      'retailEstimateRationale',
    ],
  },
} as const;

export const EXTRACTION_PROMPT =
  'Look at these photos of an item being listed for a swap. Identify ' +
  'what it is, estimate its age and condition, measure approximate ' +
  'dimensions, and estimate what it would have cost new at retail in ' +
  'NZD. Then call the submit_item_details tool exactly once with the ' +
  'extracted fields. Be conservative on retail estimates if the brand ' +
  'isn’t clearly identifiable — set retailEstimateConfidence to LOW ' +
  'and explain why in retailEstimateRationale.';
