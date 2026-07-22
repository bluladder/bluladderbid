/**
 * planPaymentBreakdown — derives the exact payment schedule the billing
 * system will charge:
 *
 *   1. Deposit due today = exactly 20% of the authoritative annual total,
 *      rounded to the nearest cent (standard currency rounding).
 *   2. Remaining 80% is split across 11 monthly installments.
 *   3. When 11 identical cent-based payments cannot reconcile exactly, the
 *      first 10 installments are the floor value and the 11th (final)
 *      installment absorbs the remaining cents so the schedule reconciles
 *      to the annual total exactly.
 *
 * Invariant: `depositCents + regularMonthlyCents * 10 + finalMonthlyCents
 * === annualTotalCents`. Whole-dollar helpers are exposed for the UI; all
 * reconciliation math happens in integer cents so it never drifts.
 *
 * Savings mirror the authoritative bundle savings when present; otherwise
 * derived from an explicit comparable one-time total.
 */
export interface PlanPaymentBreakdown {
  annualTotal: number;
  annualTotalCents: number;
  depositAmount: number;
  depositAmountCents: number;
  monthlyPayment: number;
  monthlyPaymentCents: number;
  finalPayment: number;
  finalPaymentCents: number;
  regularPaymentCount: number;
  remainingPayments: number;
  hasFinalAdjustment: boolean;
  comparisonTotal: number;
  savings: number;
}

export const PLAN_DEPOSIT_PERCENT = 0.2;
export const PLAN_REMAINING_MONTHS = 11;

function toCents(dollars: number): number {
  // Round-half-away-from-zero to avoid banker's-rounding surprises on .x5 inputs.
  return Math.round(Number(dollars) * 100 + Number.EPSILON);
}

function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export function computePlanPaymentBreakdown(opts: {
  annualTotal: number;
  authoritativeSavings?: number;
  comparisonTotal?: number;
}): PlanPaymentBreakdown | null {
  const annualNum = Number(opts.annualTotal);
  if (!Number.isFinite(annualNum) || annualNum <= 0) return null;

  const annualTotalCents = toCents(annualNum);
  if (annualTotalCents <= 0) return null;

  // Exactly 20%, rounded to the nearest cent — the deposit shown to the
  // customer must equal what the processor will charge today.
  const depositAmountCents = Math.round(annualTotalCents * PLAN_DEPOSIT_PERCENT);
  const remainingCents = annualTotalCents - depositAmountCents;
  if (depositAmountCents <= 0 || remainingCents <= 0) return null;

  // 10 regular installments at the floor value + one final installment that
  // absorbs the remaining cents so the schedule reconciles exactly.
  const monthlyPaymentCents = Math.floor(remainingCents / PLAN_REMAINING_MONTHS);
  const finalPaymentCents = remainingCents - monthlyPaymentCents * (PLAN_REMAINING_MONTHS - 1);
  if (monthlyPaymentCents <= 0 || finalPaymentCents <= 0) return null;

  const hasFinalAdjustment = finalPaymentCents !== monthlyPaymentCents;

  const comparisonInput = Number(opts.comparisonTotal);
  const comparisonCents = Number.isFinite(comparisonInput) && comparisonInput > 0
    ? toCents(comparisonInput)
    : 0;
  const authoritativeSavingsInput = Number(opts.authoritativeSavings);
  const authoritativeSavingsCents = Number.isFinite(authoritativeSavingsInput) && authoritativeSavingsInput > 0
    ? toCents(authoritativeSavingsInput)
    : 0;
  const savingsCents = authoritativeSavingsCents > 0
    ? authoritativeSavingsCents
    : comparisonCents > annualTotalCents
      ? comparisonCents - annualTotalCents
      : 0;

  return {
    annualTotal: fromCents(annualTotalCents),
    annualTotalCents,
    depositAmount: fromCents(depositAmountCents),
    depositAmountCents,
    monthlyPayment: fromCents(monthlyPaymentCents),
    monthlyPaymentCents,
    finalPayment: fromCents(finalPaymentCents),
    finalPaymentCents,
    regularPaymentCount: PLAN_REMAINING_MONTHS - 1,
    remainingPayments: PLAN_REMAINING_MONTHS,
    hasFinalAdjustment,
    comparisonTotal: fromCents(comparisonCents > 0 ? comparisonCents : annualTotalCents + savingsCents),
    savings: fromCents(savingsCents),
  };
}