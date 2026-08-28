import {
  getSubscription,
} from "../lib/stripe-client.js";

import {
  cancelBillingAccountBySubscriptionId,
  updateBillingAccountBySubscriptionId,
  upsertBillingAccountFromCheckout,
  type BillingStatus,
} from "../database/postgres/billing/billing-repository.js";

import {
  PLAN_WEBSITE_LIMITS,
  getPlanForPriceId,
  isSelfServePlanTier,
} from "./billing-service.js";

/* ========================================
   STRIPE EVENT SHAPES

   Minimal shapes for only the fields this
   handler actually reads - not a full
   mirror of Stripe's types.
======================================== */

interface StripeEvent {
  type: string;
  data: {
    object: Record<string, unknown>;
  };
}

function toIsoOrNull(
  unixSeconds: unknown
): string | null {
  if (
    typeof unixSeconds !== "number"
  ) {
    return null;
  }

  return new Date(
    unixSeconds * 1000
  ).toISOString();
}

/* ========================================
   CHECKOUT SESSION COMPLETED

   Fired once the customer finishes paying.
   The session carries client_reference_id
   (our user id) and metadata.planTier set
   when the Checkout Session was created.
   Fetches the subscription itself for an
   accurate status/current_period_end/price
   rather than trusting the session payload.
======================================== */

async function handleCheckoutSessionCompleted(
  session: Record<string, unknown>
): Promise<void> {
  const userId =
    typeof session.client_reference_id ===
    "string"
      ? session.client_reference_id
      : null;

  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : null;

  const subscriptionId =
    typeof session.subscription ===
    "string"
      ? session.subscription
      : null;

  if (
    !userId ||
    !customerId ||
    !subscriptionId
  ) {
    console.warn(
      "[stripe-webhook] checkout.session.completed missing required fields, skipping.",
      { userId, customerId, subscriptionId }
    );

    return;
  }

  const subscription =
    await getSubscription(
      subscriptionId
    );

  const priceId =
    subscription.items.data[0]?.price
      .id ?? null;

  const planTier =
    priceId
      ? getPlanForPriceId(priceId)
      : null;

  if (!priceId || !planTier) {
    console.warn(
      "[stripe-webhook] checkout.session.completed price id did not match a known plan, skipping.",
      { priceId }
    );

    return;
  }

  await upsertBillingAccountFromCheckout(
    {
      userId,
      planTier,
      websiteLimit:
        PLAN_WEBSITE_LIMITS[planTier],
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      stripePriceId: priceId,
      status:
        subscription.status as BillingStatus,
      currentPeriodEnd: toIsoOrNull(
        subscription.current_period_end
      ),
    }
  );
}

/* ========================================
   SUBSCRIPTION UPDATED

   Covers plan changes, renewals, and
   dunning-state changes (past_due, etc).
======================================== */

async function handleSubscriptionUpdated(
  subscription: Record<string, unknown>
): Promise<void> {
  const subscriptionId =
    typeof subscription.id === "string"
      ? subscription.id
      : null;

  if (!subscriptionId) {
    return;
  }

  const items =
    subscription.items as
      | {
          data?: {
            price?: { id?: string };
          }[];
        }
      | undefined;

  const priceId =
    items?.data?.[0]?.price?.id ?? null;

  const planTier =
    priceId
      ? getPlanForPriceId(priceId)
      : null;

  if (
    !priceId ||
    !planTier ||
    !isSelfServePlanTier(planTier)
  ) {
    console.warn(
      "[stripe-webhook] customer.subscription.updated price id did not match a known plan, skipping.",
      { priceId }
    );

    return;
  }

  const updated =
    await updateBillingAccountBySubscriptionId(
      {
        stripeSubscriptionId:
          subscriptionId,
        planTier,
        websiteLimit:
          PLAN_WEBSITE_LIMITS[planTier],
        status:
          subscription.status as BillingStatus,
        stripePriceId: priceId,
        currentPeriodEnd: toIsoOrNull(
          subscription.current_period_end
        ),
      }
    );

  if (!updated) {
    console.warn(
      "[stripe-webhook] customer.subscription.updated found no matching billing account.",
      { subscriptionId }
    );
  }
}

/* ========================================
   SUBSCRIPTION DELETED
======================================== */

async function handleSubscriptionDeleted(
  subscription: Record<string, unknown>
): Promise<void> {
  const subscriptionId =
    typeof subscription.id === "string"
      ? subscription.id
      : null;

  if (!subscriptionId) {
    return;
  }

  const canceled =
    await cancelBillingAccountBySubscriptionId(
      subscriptionId
    );

  if (!canceled) {
    console.warn(
      "[stripe-webhook] customer.subscription.deleted found no matching billing account.",
      { subscriptionId }
    );
  }
}

/* ========================================
   DISPATCH
======================================== */

export async function handleStripeWebhookEvent(
  event: StripeEvent
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      await handleCheckoutSessionCompleted(
        event.data.object
      );

      return;
    }

    case "customer.subscription.updated": {
      await handleSubscriptionUpdated(
        event.data.object
      );

      return;
    }

    case "customer.subscription.deleted": {
      await handleSubscriptionDeleted(
        event.data.object
      );

      return;
    }

    default: {
      /*
       * Every other event type is
       * intentionally ignored - Stripe
       * sends far more event types than
       * this integration needs to react
       * to.
       */
      return;
    }
  }
}
