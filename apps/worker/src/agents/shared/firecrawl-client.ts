/* ========================================
   FIRECRAWL CLIENT

   Raw fetch wrapper around Firecrawl's
   /v1/scrape endpoint - matches this
   codebase's existing style for external
   APIs (see openrouter-provider.ts,
   google-oauth-client.ts). Handles
   JS-rendered pages via Firecrawl's headless
   browser, which the plain fetch+regex
   analyzer in website-analyzer.ts cannot.
======================================== */

const FIRECRAWL_SCRAPE_URL =
  "https://api.firecrawl.dev/v1/scrape";

export interface FirecrawlMetadata {
  title?: string;
  description?: string;
  statusCode?: number;
  sourceURL?: string;
}

export interface FirecrawlScrapeData {
  markdown: string;
  html: string;
  links: string[];
  metadata: FirecrawlMetadata;
}

interface FirecrawlScrapeResponse {
  success: boolean;
  error?: string;
  data?: {
    markdown?: string;
    html?: string;
    links?: string[];
    metadata?: FirecrawlMetadata;
  };
}

function getApiKey(): string {
  const apiKey =
    process.env.FIRECRAWL_API_KEY;

  if (!apiKey) {
    throw new Error(
      "FIRECRAWL_API_KEY is not configured."
    );
  }

  return apiKey;
}

/* ========================================
   SCRAPE
======================================== */

export async function scrapeWithFirecrawl(
  url: string
): Promise<FirecrawlScrapeData> {
  const apiKey = getApiKey();

  const response = await fetch(
    FIRECRAWL_SCRAPE_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify({
        url,
        formats: [
          "markdown",
          "html",
          "links",
        ],
        /*
         * false: keep full-page HTML (nav,
         * footer, etc) so heading/image/link
         * counts stay comparable to the
         * regex analyzer, which crawls the
         * whole page rather than just the
         * extracted article body.
         */
        onlyMainContent: false,
      }),
    }
  );

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `Firecrawl scrape failed (${response.status}): ${text.slice(
        0,
        300
      )}`
    );
  }

  const result =
    (await response.json()) as FirecrawlScrapeResponse;

  if (!result.success || !result.data) {
    throw new Error(
      `Firecrawl scrape failed: ${
        result.error ??
        "no data returned."
      }`
    );
  }

  const {
    markdown,
    html,
    links,
    metadata,
  } = result.data;

  if (
    typeof markdown !== "string" ||
    typeof html !== "string"
  ) {
    throw new Error(
      "Firecrawl response did not include markdown/html content."
    );
  }

  return {
    markdown,
    html,
    links: links ?? [],
    metadata: metadata ?? {},
  };
}
