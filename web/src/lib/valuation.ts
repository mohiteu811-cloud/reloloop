// Pure depreciation math. No I/O, no Prisma — keeps it trivially
// testable. See reloloop-schema.md §3.1 step 3 and §3.2.

export type Condition = 'LIKE_NEW' | 'GOOD' | 'USED' | 'WORN';
export type RetailConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

export type DepreciationCurve = {
  yearOneRetention: number; // e.g. 0.55
  yearlyDecay: number; // e.g. 0.15
  floor: number; // e.g. 0.10
};

export type ValuationInput = {
  originalRetailCents: number;
  retailConfidence: RetailConfidence;
  retailRationale: string;
  ageYears: number;
  condition: Condition;
  depreciationCurve: DepreciationCurve;
};

export type ValuationBreakdown = {
  computedAt: string;
  originalRetailCents: number;
  retailConfidence: RetailConfidence;
  retailRationale: string;
  ageYears: number;
  depreciationRetention: number;
  depreciationCurve: DepreciationCurve;
  condition: Condition;
  conditionMultiplier: number;
  estimatedValueCents: number;
};

// Condition multipliers from reloloop-schema.md §3.1 step 3.
const CONDITION_MULTIPLIERS: Record<Condition, number> = {
  LIKE_NEW: 1.0,
  GOOD: 0.85,
  USED: 0.65,
  WORN: 0.4,
};

export function computeValuation(input: ValuationInput): ValuationBreakdown {
  const { originalRetailCents, ageYears, condition, depreciationCurve: curve } = input;

  // retention = max(floor, yearOneRetention * (1 - yearlyDecay)^(ageYears - 1))
  // For ageYears < 1, treat as year 1 (the yearOneRetention already
  // captures the steep first-year drop; no extra decay yet).
  const yearsBeyondOne = Math.max(0, ageYears - 1);
  const rawRetention =
    curve.yearOneRetention * Math.pow(1 - curve.yearlyDecay, yearsBeyondOne);
  const depreciationRetention = Math.max(curve.floor, rawRetention);

  const conditionMultiplier = CONDITION_MULTIPLIERS[condition];
  const estimatedValueCents = Math.round(
    originalRetailCents * depreciationRetention * conditionMultiplier,
  );

  return {
    computedAt: new Date().toISOString(),
    originalRetailCents,
    retailConfidence: input.retailConfidence,
    retailRationale: input.retailRationale,
    ageYears,
    depreciationRetention,
    depreciationCurve: curve,
    condition,
    conditionMultiplier,
    estimatedValueCents,
  };
}
