import { createHmac, timingSafeEqual } from "node:crypto";

/* ========================================
   STRIPE CLIENT

   Raw fetch wrapper around Stripe's REST API -
   matches this codebase's existing style for
   external APIs (see firecrawl-client.ts,
   serpapi-client.ts, google-oauth-client.ts).
   No official SDK dependency.
======================================== */

const STRIPE_API_BASE =
  "https://api.stripe.com/v1";

function getSecretKey(): string {
  const key =
    process.env.STRIPE_SECRET_KEY;

  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not configured."
    );
  }

  return key;
}

/* ========================================
   FORM ENCODING

   Stripe's API takes application/x-www-form
   -urlencoded bodies with bracketed keys for
   nested fields (e.g. line_items[0][price]).
======================================== */

function appendFormEntries(
  form: URLSearchParams,
  prefix: string,
  value: unknown
): void {
  if (
    value === undefined ||
    value === null
  ) {
    return;
  }

  if (
    Array.isArray(value)
  ) {
    value.forEach(
      (item, index) => {
        appendFormEntries(
          form,
          `${prefix}[${index}]`,
          item
        );
      }
    );

    return;
  }

  if (
    typeof value === "object"
  ) {
    for (
      const [key, nested]
      of Object.entries(
        value as Record<
          string,
          unknown
        >
      )
    ) {
      appendFormEntries(
        form,
        `${prefix}[${key}]`,
        nested
      );
    }

    return;
  }

  form.append(
    prefix,
    String(value)
  );
}

function toFormBody(
  fields: Record<string, unknown>
): URLSearchParams {
  const form =
    new URLSearchParams();

  for (
    const [key, value]
    of Object.entries(fields)
  ) {
    appendFormEntries(
      form,
      key,
      value
    );
  }

  return form;
}

async function stripeRequest<T>(
  method: "GET" | "POST",
  path: string,
  fields?: Record<string, unknown>
): Promise<T> {
  const secretKey =
    getSecretKey();

  const response =
    await fetch(
      `${STRIPE_API_BASE}${path}`,
      {
        method,

        headers: {
          Authorization: `Bearer ${secretKey}`,

          ...(method === "POST"
            ? {
                "Content-Type":
                  "application/x-www-form-urlencoded",
              }
            : {}),
        },

        body:
          method === "POST" && fields
            ? toFormBody(
                fields
              ).toString()
            : undefined,
      }
    );

  const body =
    (await response.json()) as
      | T
      | { error?: { message?: string } };

  if (!response.ok) {
    const message =
      (
        body as {
          error?: {
            message?: string;
          };
        }
      ).error?.message ??
      `Stripe request failed (${response.status}).`;

    throw new Error(
      `Stripe API error: ${message}`
    );
  }

  return body as T;
}

/* ========================================
   PRODUCTS + PRICES

   Used by the one-off setup script, not by
   the running server.
======================================== */

export interface StripeProduct {
  id: string;
  name: string;
}

export interface StripePrice {
  id: string;
  unit_amount: number | null;
  currency: string;
  recurring:
    | { interval: string }
    | null;
}

export async function createStripeProduct(
  name: string,
  description?: string
): Promise<StripeProduct> {
  return stripeRequest<StripeProduct>(
    "POST",
    "/products",
    {
      name,
      description,
    }
  );
}

export async function createStripeRecurringPrice(
  productId: string,
  unitAmountCents: number,
  currency = "usd",
  interval:
    | "month"
    | "year" = "month"
): Promise<StripePrice> {
  return stripeRequest<StripePrice>(
    "POST",
    "/prices",
    {
      product: productId,
      unit_amount: unitAmountCents,
      currency,
      recurring: { interval },
    }
  );
}

/* ========================================
   CHECKOUT SESSION
======================================== */

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
}

export interface CreateCheckoutSessionInput {
  priceId: string;
  customerEmail: string;
  clientReferenceId: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}

export async function createCheckoutSession(
  input: CreateCheckoutSessionInput
): Promise<StripeCheckoutSession> {
  return stripeRequest<StripeCheckoutSession>(
    "POST",
    "/checkout/sessions",
    {
      mode: "subscription",

      line_items: [
        {
          price: input.priceId,
          quantity: 1,
        },
      ],

      customer_email:
        input.customerEmail,

      client_reference_id:
        input.clientReferenceId,

      success_url:
        input.successUrl,

      cancel_url:
        input.cancelUrl,

      metadata: input.metadata,

      subscription_data: {
        metadata: input.metadata,
      },
    }
  );
}

/* ========================================
   SUBSCRIPTION LOOKUP
======================================== */

export interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  current_period_end: number;
  items: {
    data: {
      price: { id: string };
    }[];
  };
}

export async function getSubscription(
  subscriptionId: string
): Promise<StripeSubscription> {
  return stripeRequest<StripeSubscription>(
    "GET",
    `/subscriptions/${subscriptionId}`
  );
}

/* ========================================
   WEBHOOK SIGNATURE VERIFICATION

   Stripe's Stripe-Signature header looks like
   "t=<timestamp>,v1=<hex hmac>[,v0=...]".
   The signed payload is "<timestamp>.<rawBody>",
   HMAC-SHA256'd with the webhook signing
   secret. A 5-minute tolerance window guards
   against replay of an intercepted event.
======================================== */

const WEBHOOK_TOLERANCE_SECONDS =
  300;

export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string
): boolean {
  const parts = new Map(
    signatureHeader
      .split(",")
      .map((part) => {
        const [key, value] =
          part.split("=");

        return [
          key?.trim() ?? "",
          value?.trim() ?? "",
        ] as [string, string];
      })
  );

  const timestamp =
    parts.get("t");

  const signature =
    parts.get("v1");

  if (
    !timestamp ||
    !signature
  ) {
    return false;
  }

  const timestampSeconds =
    Number(timestamp);

  if (
    !Number.isFinite(
      timestampSeconds
    )
  ) {
    return false;
  }

  const ageSeconds =
    Math.abs(
      Date.now() / 1000 -
        timestampSeconds
    );

  if (
    ageSeconds >
    WEBHOOK_TOLERANCE_SECONDS
  ) {
    return false;
  }

  const signedPayload =
    `${timestamp}.${rawBody}`;

  const expectedSignature =
    createHmac(
      "sha256",
      webhookSecret
    )
      .update(signedPayload)
      .digest("hex");

  const expectedBuffer =
    Buffer.from(
      expectedSignature,
      "hex"
    );

  const actualBuffer =
    Buffer.from(
      signature,
      "hex"
    );

  if (
    expectedBuffer.length !==
    actualBuffer.length
  ) {
    return false;
  }

  return timingSafeEqual(
    expectedBuffer,
    actualBuffer
  );
}
