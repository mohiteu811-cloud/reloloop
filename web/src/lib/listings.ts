import { z } from 'zod';

export const Condition = z.enum(['LIKE_NEW', 'GOOD', 'USED', 'WORN']);

// reloloop-schema.md §2.2 Listing model. M1 captures the user-editable
// fields manually; M3 will replace most of these with Claude-extracted
// values that the user can override on the review screen.
export const createListingSchema = z.object({
  title: z.string().min(1).max(80),
  description: z.string().max(2000).optional(),
  categoryId: z.string().min(1),
  condition: Condition,
  brand: z.string().max(80).optional(),
  model: z.string().max(80).optional(),
  ageYears: z.number().min(0).max(100).optional(),
  widthCm: z.number().int().min(0).max(1000).optional(),
  depthCm: z.number().int().min(0).max(1000).optional(),
  heightCm: z.number().int().min(0).max(1000).optional(),
  askingValueCents: z.number().int().min(100),
  originCityId: z.string().min(1),
  wantedCityId: z.string().min(1),
  wantedNotes: z.string().max(2000).optional(),
  availableUntilISO: z.string().datetime(),
});

export type CreateListingInput = z.infer<typeof createListingSchema>;

export const updateListingSchema = createListingSchema.partial();
export type UpdateListingInput = z.infer<typeof updateListingSchema>;
