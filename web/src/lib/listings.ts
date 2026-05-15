import { z } from 'zod';

export const Condition = z.enum(['LIKE_NEW', 'GOOD', 'USED', 'WORN']);

// `z.string().datetime()` only enforces the ISO 8601 format string,
// so an input like `2026-02-31T00:00:00.000Z` passes — then
// `new Date(...)` silently normalizes it to March 3rd, and we'd
// persist a different calendar day than the client sent. This
// refinement rejects overflow dates by parsing the date once and
// asserting the year/month/day components match the input prefix.
function isValidCalendarISO(s: string): boolean {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(s);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
  );
}

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
  availableUntilISO: z
    .string()
    .datetime()
    .refine(isValidCalendarISO, { message: 'invalid_calendar_date' }),
});

export type CreateListingInput = z.infer<typeof createListingSchema>;

export const updateListingSchema = createListingSchema.partial();
export type UpdateListingInput = z.infer<typeof updateListingSchema>;
