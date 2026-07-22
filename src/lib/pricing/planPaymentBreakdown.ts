/**
 * planPaymentBreakdown — derives a fully reconciled 20% deposit + 11 monthly
 * installment schedule from an authoritative Annual Maintenance Plan total.
 *
 * Invariant: `depositAmount + monthlyPayment * remainingPayments === annualTotal`
 * (all values are integer dollars). We hold the monthly payment at the natural
 * rounding of (annual × 80%) / 11 and absorb the reconciliation difference in
 * the deposit, which stays within a couple of dollars of exactly 20%. This
 * prevents the UI from showing a monthly amount that visibly conflicts with
 * the deposit or the annual total.
 *
 * Savings mirror the authoritative bundle savings when present. When the
 * server did not compute a savings figure but a comparable one-time value is
 * supplied, the caller may pass it in to derive a positive savings amount.
 */
export interface PlanPaymentBreakdown {
  annualTotal: number;
  depositAmount: number;
  monthlyPayment: number;
  remainingPayments: number;
  comparisonTotal: number;
  savings: number;
}

export const PLAN_DEPOSIT_PERCENT = 0.2;
export const PLAN_REMAINING_MONTHS = 11;

export function computePlanPaymentBreakdown(opts: {
  annualTotal: number;
  authoritativeSavings?: number;
  comparisonTotal?: number;
}): PlanPaymentBreakdown | null {
  const annualTotal = Math.round(Number(opts.annualTotal) || 0);
  if (!Number.isFinite(annualTotal) || annualTotal <= 0) return null;

  const monthlyPayment = Math.max(
    0,
    Math.round((annualTotal * (1 - PLAN_DEPOSIT_PERCENT)) / PLAN_REMAINING_MONTHS),
  );
  // Absorb rounding drift in the deposit so the schedule reconciles exactly.
  const depositAmount = annualTotal - monthlyPayment * PLAN_REMAINING_MONTHS;
  if (depositAmount <= 0 || monthlyPayment <= 0) return null;

  const comparisonTotal = Math.max(0, Math.round(opts.comparisonTotal ?? 0));
  const authoritativeSavings = Math.max(0, Math.round(opts.authoritativeSavings ?? 0));
  // Prefer the authoritative bundle savings; fall back to comparison math only
  // when the bundle didn't ship one but the caller supplied a comparable total.
  const savings = authoritativeSavings > 0
    ? authoritativeSavings
    : comparisonTotal > annualTotal
      ? comparisonTotal - annualTotal
      : 0;

  return {
    annualTotal,
    depositAmount,
    monthlyPayment,
    remainingPayments: PLAN_REMAINING_MONTHS,
    comparisonTotal: comparisonTotal > 0 ? comparisonTotal : annualTotal + savings,
    savings,
  };
}