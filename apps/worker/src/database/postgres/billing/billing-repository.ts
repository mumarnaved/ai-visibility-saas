import { randomUUID } from "node:crypto";

import { pool } from "../connection.js";

export type PlanTier =
  | "free"
  | "growth"
  | "scale"
  | "enterprise"
  | "white_label";

export type BillingStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete";

export interface BillingAccount {
  id: string;
  userId: string;
  planTier: PlanTier;
  status: BillingStatus;
  websiteLimit: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  currentPeriodEnd: string | null;
}

const FREE_TIER_DEFAULT: Omit<
  BillingAccount,
  "id" | "userId"
> = {
  planTier: "free",
  status: "active",
  websiteLimit: 1,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  stripePriceId: null,
  currentPeriodEnd: null,
};

function normalizeRow(row: {
  id: string;
  user_id: string;
  plan_tier: PlanTier;
  status: BillingStatus;
  website_limit: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  current_period_end: Date | string | null;
}): BillingAccount {
  return {
    id: row.id,
    userId: row.user_id,
    planTier: row.plan_tier,
    status: row.status,
    websiteLimit: row.website_limit,

    stripeCustomerId:
      row.stripe_customer_id,

    stripeSubscriptionId:
      row.stripe_subscription_id,

    stripePriceId:
      row.stripe_price_id,

    currentPeriodEnd:
      row.current_period_end instanceof
      Date
        ? row.current_period_end.toISOString()
        : row.current_period_end,
  };
}

/* ========================================
   GET BILLING ACCOUNT BY USER

   No row means the user has never
   subscribed - callers should treat that
   as the free tier rather than an error.
======================================== */

export async function getBillingAccountByUserId(
  userId: string
): Promise<BillingAccount | null> {
  const result =
    await pool.query(
      `
        SELECT
          id,
          user_id,
          plan_tier,
          status,
          website_limit,
          stripe_customer_id,
          stripe_subscription_id,
          stripe_price_id,
          current_period_end
        FROM platform.billing_accounts
        WHERE user_id = $1
        LIMIT 1
      `,
      [userId]
    );

  const row = result.rows[0];

  return row
    ? normalizeRow(row)
    : null;
}

/* ========================================
   GET EFFECTIVE PLAN FOR USER

   Always returns a usable billing account,
   falling back to the free-tier default
   when no row exists.
======================================== */

export async function getEffectivePlanForUser(
  userId: string
): Promise<
  Omit<BillingAccount, "id"> & {
    userId: string;
  }
> {
  const account =
    await getBillingAccountByUserId(
      userId
    );

  return (
    account ?? {
      userId,
      ...FREE_TIER_DEFAULT,
    }
  );
}

/* ========================================
   GET EFFECTIVE PLAN FOR TENANT

   Resolves through the tenant's workspace
   owner. A tenant with no owning workspace
   member (shouldn't happen in practice)
   also falls back to the free-tier default
   rather than throwing, so a data gap
   degrades to "most restrictive", not a
   500.
======================================== */

export async function getEffectivePlanForTenant(
  tenantId: string
): Promise<
  Omit<BillingAccount, "id" | "userId">
> {
  const result =
    await pool.query<{
      plan_tier: PlanTier;
      status: BillingStatus;
      website_limit: number;
      stripe_customer_id: string | null;
      stripe_subscription_id: string | null;
      stripe_price_id: string | null;
      current_period_end:
        Date | string | null;
    }>(
      `
        SELECT
          COALESCE(ba.plan_tier, 'free') AS plan_tier,
          COALESCE(ba.status, 'active') AS status,
          COALESCE(ba.website_limit, 1) AS website_limit,
          ba.stripe_customer_id,
          ba.stripe_subscription_id,
          ba.stripe_price_id,
          ba.current_period_end
        FROM platform.tenants t
        JOIN platform.workspaces w
          ON w.tenant_id = t.id
        JOIN platform.workspace_members wm
          ON wm.workspace_id = w.id
          AND wm.role = 'owner'
        LEFT JOIN platform.billing_accounts ba
          ON ba.user_id = wm.user_id
        WHERE t.id = $1
        LIMIT 1
      `,
      [tenantId]
    );

  const row = result.rows[0];

  if (!row) {
    return FREE_TIER_DEFAULT;
  }

  return {
    planTier: row.plan_tier,
    status: row.status,
    websiteLimit:
      row.website_limit,

    stripeCustomerId:
      row.stripe_customer_id,

    stripeSubscriptionId:
      row.stripe_subscription_id,

    stripePriceId:
      row.stripe_price_id,

    currentPeriodEnd:
      row.current_period_end instanceof
      Date
        ? row.current_period_end.toISOString()
        : row.current_period_end,
  };
}

/* ========================================
   COUNT TENANTS OWNED BY USER
======================================== */

export async function countTenantsOwnedByUser(
  userId: string
): Promise<number> {
  const result =
    await pool.query<{
      count: string;
    }>(
      `
        SELECT COUNT(*)::text AS count
        FROM platform.tenants t
        JOIN platform.workspaces w
          ON w.tenant_id = t.id
        JOIN platform.workspace_members wm
          ON wm.workspace_id = w.id
        WHERE wm.user_id = $1
      `,
      [userId]
    );

  return Number(
    result.rows[0]?.count ?? "0"
  );
}

/* ========================================
   UPSERT ON CHECKOUT COMPLETION
======================================== */

export interface CheckoutCompletionInput {
  userId: string;
  planTier: PlanTier;
  websiteLimit: number;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  status: BillingStatus;
  currentPeriodEnd: string | null;
}

export async function upsertBillingAccountFromCheckout(
  input: CheckoutCompletionInput
): Promise<void> {
  await pool.query(
    `
      INSERT INTO platform.billing_accounts (
        id,
        user_id,
        plan_tier,
        status,
        website_limit,
        stripe_customer_id,
        stripe_subscription_id,
        stripe_price_id,
        current_period_end
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9
      )
      ON CONFLICT (user_id) DO UPDATE SET
        plan_tier = EXCLUDED.plan_tier,
        status = EXCLUDED.status,
        website_limit = EXCLUDED.website_limit,
        stripe_customer_id = EXCLUDED.stripe_customer_id,
        stripe_subscription_id = EXCLUDED.stripe_subscription_id,
        stripe_price_id = EXCLUDED.stripe_price_id,
        current_period_end = EXCLUDED.current_period_end,
        updated_at = NOW()
    `,
    [
      randomUUID(),
      input.userId,
      input.planTier,
      input.status,
      input.websiteLimit,
      input.stripeCustomerId,
      input.stripeSubscriptionId,
      input.stripePriceId,
      input.currentPeriodEnd,
    ]
  );
}

/* ========================================
   UPDATE BY SUBSCRIPTION ID

   Used by customer.subscription.updated -
   the row is looked up by subscription id
   rather than user id since the webhook
   payload only carries Stripe identifiers.
======================================== */

export interface SubscriptionUpdateInput {
  stripeSubscriptionId: string;
  planTier: PlanTier;
  websiteLimit: number;
  status: BillingStatus;
  stripePriceId: string;
  currentPeriodEnd: string | null;
}

export async function updateBillingAccountBySubscriptionId(
  input: SubscriptionUpdateInput
): Promise<boolean> {
  const result =
    await pool.query(
      `
        UPDATE platform.billing_accounts
        SET
          plan_tier = $2,
          status = $3,
          website_limit = $4,
          stripe_price_id = $5,
          current_period_end = $6,
          updated_at = NOW()
        WHERE stripe_subscription_id = $1
      `,
      [
        input.stripeSubscriptionId,
        input.planTier,
        input.status,
        input.websiteLimit,
        input.stripePriceId,
        input.currentPeriodEnd,
      ]
    );

  return (
    (result.rowCount ?? 0) > 0
  );
}

/* ========================================
   CANCEL BY SUBSCRIPTION ID

   Reverts the account to the free tier -
   used by customer.subscription.deleted.
======================================== */

export async function cancelBillingAccountBySubscriptionId(
  stripeSubscriptionId: string
): Promise<boolean> {
  const result =
    await pool.query(
      `
        UPDATE platform.billing_accounts
        SET
          plan_tier = 'free',
          status = 'canceled',
          website_limit = 1,
          updated_at = NOW()
        WHERE stripe_subscription_id = $1
      `,
      [stripeSubscriptionId]
    );

  return (
    (result.rowCount ?? 0) > 0
  );
}
