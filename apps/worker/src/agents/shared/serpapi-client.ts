/* ========================================
   SERPAPI CLIENT

   Raw fetch wrapper around SerpApi's Google
   Search engine - matches this codebase's
   existing style for external APIs (see
   openrouter-provider.ts, firecrawl-client.ts).

   One query per competitor: `site:{domain}`.
   This is the only query shape that reliably
   returns `search_information.total_results`
   (Google's indexed-page count for that
   domain) - the free-tier proxy this is
   actually used for. Empirically, `site:`
   queries do NOT reliably return
   knowledge_graph or related_searches (both
   were absent testing against a real site),
   so this deliberately stays a single call
   per competitor rather than a second query
   chasing signals that mostly aren't there
   for this query shape - SerpApi's free tier
   is quota-limited (~100 searches/month).
======================================== */

const SERPAPI_SEARCH_URL =
  "https://serpapi.com/search.json";

export interface SiteIndexSignals {
  /*
   * Google's own approximate count of pages
   * it has indexed for this domain - a
   * long-standing free-tier SEO proxy for
   * "content footprint," not a verified
   * organic-keyword-ranking count.
   */
  indexedPagesEstimate: number | null;

  /*
   * How many organic results SerpApi actually
   * returned on this page (max ~10) - useful
   * to distinguish "0 indexed pages" from
   * "some indexed pages but total_results
   * missing/zero due to a quirky query".
   */
  organicResultsCount: number;

  /*
   * True when Google silently corrected/
   * broadened the query (e.g. no exact-match
   * results for the site: filter) - a signal
   * the domain has very little indexed
   * content, worth surfacing as a gap.
   */
  wasQueryBroadened: boolean;
}

function getApiKey(): string {
  const apiKey =
    process.env.SERPAPI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "SERPAPI_API_KEY is not configured."
    );
  }

  return apiKey;
}

/* ========================================
   GET SITE INDEX SIGNALS
======================================== */

export async function getSiteIndexSignals(
  domain: string
): Promise<SiteIndexSignals> {
  const apiKey = getApiKey();

  const url = new URL(
    SERPAPI_SEARCH_URL
  );

  url.searchParams.set(
    "engine",
    "google"
  );

  url.searchParams.set(
    "q",
    `site:${domain}`
  );

  url.searchParams.set(
    "api_key",
    apiKey
  );

  const response = await fetch(
    url.toString()
  );

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `SerpApi search failed (${response.status}): ${text.slice(
        0,
        300
      )}`
    );
  }

  const body =
    (await response.json()) as {
      error?: string;
      search_information?: {
        total_results?: number;
        organic_results_state?: string;
      };
      organic_results?: unknown[];
    };

  if (body.error) {
    throw new Error(
      `SerpApi search failed: ${body.error}`
    );
  }

  const organicResultsCount = (
    body.organic_results ?? []
  ).length;

  const organicResultsState =
    body.search_information
      ?.organic_results_state ?? "";

  return {
    indexedPagesEstimate:
      typeof body.search_information
        ?.total_results === "number"
        ? body.search_information
            .total_results
        : null,

    organicResultsCount,

    wasQueryBroadened:
      !organicResultsState
        .toLowerCase()
        .includes("exact spelling"),
  };
}
