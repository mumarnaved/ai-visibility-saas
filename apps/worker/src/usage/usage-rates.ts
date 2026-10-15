/* ========================================
   USAGE RATES

   Per-unit prices (USD) used to turn a metered
   call into cost_estimate. These are ESTIMATES
   to show tenants and the owner roughly what
   a workspace costs to serve; they are not read
   from provider invoices. Edit this file when a
   plan or price changes.

   Assumptions (check against your own plans):
   - Firecrawl: 1 credit per /v1/scrape, priced
     at the Hobby plan (about $16 per 3,000
     credits). Higher plans are cheaper per
     credit, so this errs high.
   - SerpApi: 1 search per query, priced at the
     Developer plan (about $75 per 5,000
     searches). The free tier is $0 up to its
     monthly quota, so this errs high there.
   - OpenRouter: priced per million tokens, per
     model. ":free" models cost nothing. A paid
     model that is not listed below is priced at
     DEFAULT_OPENROUTER_RATE, so switching the
     model in openrouter-provider.ts never makes
     the estimate silently zero.
======================================== */

export const USAGE_PROVIDERS = [
  "firecrawl",
  "serpapi",
  "openrouter",
] as const;

export type UsageProvider =
  (typeof USAGE_PROVIDERS)[number];

export const isUsageProvider = (
  value: string
): value is UsageProvider =>
  (USAGE_PROVIDERS as readonly string[]).includes(
    value
  );

export interface ProviderRate {
  /* What one unit is, for display ("credit", "search", "token"). */
  unit: string;

  /* USD per unit. OpenRouter is priced per model instead. */
  usdPerUnit: number;
}

export const PROVIDER_RATES: Record<
  UsageProvider,
  ProviderRate
> = {
  firecrawl: { unit: "credit", usdPerUnit: 0.0053 },
  serpapi: { unit: "search", usdPerUnit: 0.015 },
  openrouter: { unit: "token", usdPerUnit: 0 },
};

/* USD per 1,000,000 tokens. */
export interface TokenRate {
  input: number;
  output: number;
}

export const OPENROUTER_MODEL_RATES: Record<
  string,
  TokenRate
> = {
  "nvidia/nemotron-3-super-120b-a12b:free": {
    input: 0,
    output: 0,
  },
  "google/gemma-4-31b-it:free": {
    input: 0,
    output: 0,
  },
};

export const DEFAULT_OPENROUTER_RATE: TokenRate = {
  input: 1,
  output: 3,
};

export function openRouterCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const rate = model.endsWith(":free")
    ? { input: 0, output: 0 }
    : (OPENROUTER_MODEL_RATES[model] ??
      DEFAULT_OPENROUTER_RATE);

  return (
    (promptTokens * rate.input +
      completionTokens * rate.output) /
    1_000_000
  );
}

/* Cost of `units` at the provider's flat per-unit rate. */
export function costForUnits(
  provider: UsageProvider,
  units: number
): number {
  return units * PROVIDER_RATES[provider].usdPerUnit;
}
