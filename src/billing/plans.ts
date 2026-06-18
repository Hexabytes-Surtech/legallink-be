// Static plan catalog for the advocate SaaS subscription.
//
// COMPLIANCE (docs/MONETIZATION_PLAN.md §3.2 / §3.3): every plan is a FLAT software
// price, invariant to leads, conversions, advocate earnings, or directory visibility.
// There is deliberately NO per-lead, per-consultation, or percentage-of-fee option here.
// Plans are code constants (not a DB table) — they change rarely and need no seeding.

export interface BillingPlan {
  id: string;
  label: string;
  amount: number; // in paise (flat software price)
  currency: 'INR';
  periodMonths: number;
  description: string;
}

export const ADVOCATE_PLANS: Record<string, BillingPlan> = {
  advocate_pro_monthly: {
    id: 'advocate_pro_monthly',
    label: 'Advocate Pro — Monthly',
    amount: 49900, // ₹499 / month
    currency: 'INR',
    periodMonths: 1,
    description:
      'Practice tooling: scheduling calendar, matter/case management, secure chat infrastructure, and AI research-assist.',
  },
  advocate_pro_yearly: {
    id: 'advocate_pro_yearly',
    label: 'Advocate Pro — Yearly',
    amount: 499900, // ₹4,999 / year (~₹417/mo — two months free)
    currency: 'INR',
    periodMonths: 12,
    description: 'Everything in Monthly, billed yearly (about two months free).',
  },
};

export const ADVOCATE_PLAN_IDS = Object.keys(ADVOCATE_PLANS);

export function getPlan(id: string): BillingPlan | undefined {
  return ADVOCATE_PLANS[id];
}

export function listPlans(): BillingPlan[] {
  return Object.values(ADVOCATE_PLANS);
}
