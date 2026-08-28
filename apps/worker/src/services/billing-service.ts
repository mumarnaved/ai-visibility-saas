import type { PlanTier } from "../database/postgres/billing/billing-repository.js";

/* ========================================
   PLAN CATALOG

   Free Audit / Growth / Scale are self-
   serve via Stripe Checkout. Enterprise and
   White-Label are "Contact us" only - no
   automated checkout, no Stripe Price - an
   admin sets billing_accounts.plan_tier
   manually for those accounts.
======================================== */

export const PLAN_WEBSITE_LIMITS: Record<
  PlanTier,
  number
> = {
  free: 1,
  growth: 1,
  scale: 5,
  enterprise: Number.POSITIVE_INFINITY,
  white_label: Number.POSITIVE_INFINITY,
};

export const SELF_SERVE_PLAN_TIERS = [
  "growth",
  "scale",
] as const;

export type SelfServePlanTier =
  (typeof SELF_SERVE_PLAN_TIERS)[number];

export function isSelfServePlanTier(
  value: string
): value is SelfServePlanTier {
  return (
    SELF_SERVE_PLAN_TIERS as readonly string[]
  ).includes(value);
}

function getPriceEnvVar(
  planTier: SelfServePlanTier
): string {
  const envVar =
    planTier === "growth"
      ? process.env.STRIPE_PRICE_GROWTH
      : process.env.STRIPE_PRICE_SCALE;

  if (!envVar) {
    throw new Error(
      `Stripe price id for plan "${planTier}" is not configured.`
    );
  }

  return envVar;
}

export function getPriceIdForPlan(
  planTier: SelfServePlanTier
): string {
  return getPriceEnvVar(planTier);
}

export function getPlanForPriceId(
  priceId: string
): SelfServePlanTier | null {
  if (
    priceId ===
    process.env.STRIPE_PRICE_GROWTH
  ) {
    return "growth";
  }

  if (
    priceId ===
    process.env.STRIPE_PRICE_SCALE
  ) {
    return "scale";
  }

  return null;
}

/* ========================================
   PAID FEATURE ACCESS

   Stage 2 (content plan) through Stage 4
   (monitoring/reporting) require a paid
   plan - the Free Audit tier is Stage 1
   only. Enterprise/white_label are treated
   as paid even though they never go
   through Checkout.
======================================== */

export function planHasPaidFeatureAccess(
  planTier: PlanTier
): boolean {
  return planTier !== "free";
}
