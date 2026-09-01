import {
  scrapeWithFirecrawl,
} from "../agents/shared/firecrawl-client.js";

import {
  analyzeWebsite,
  cleanText,
  computeSeoScore,
  extractImages,
  extractTagText,
  normalizeUrl,
  type WebsiteAnalysisResult,
} from "./website-analyzer.js";

/* ========================================
   CATEGORIZE LINKS

   Firecrawl already returns a flat array of
   absolute URLs (formats: ["links"]) rather
   than raw <a href> tags, so this is a
   simpler pass than the regex analyzer's
   extractLinks - just bucket by hostname.
======================================== */

function categorizeLinks(
  links: string[],
  baseUrl: string
): {
  total: number;
  internal: number;
  external: number;
  internalUrls: string[];
} {
  const base = new URL(baseUrl);

  let internal = 0;
  let external = 0;

  const internalUrls =
    new Set<string>();

  for (const link of links) {
    try {
      const linkUrl = new URL(
        link,
        base
      );

      if (
        linkUrl.hostname ===
        base.hostname
      ) {
        internal++;

        linkUrl.hash = "";

        internalUrls.add(
          linkUrl.toString()
        );
      } else {
        external++;
      }
    } catch {
      // Ignore invalid URLs.
    }
  }

  return {
    total: links.length,
    internal,
    external,
    internalUrls: [
      ...internalUrls,
    ],
  };
}

/* ========================================
   ANALYZE WEBSITE WITH FIRECRAWL

   Maps Firecrawl's response into the exact
   same WebsiteAnalysisResult shape the
   regex analyzer produces, so callers (and
   everything downstream of them) don't need
   to know which path actually ran.
======================================== */

export async function analyzeWebsiteWithFirecrawl(
  inputUrl: string
): Promise<WebsiteAnalysisResult> {
  const url = normalizeUrl(inputUrl);

  const scrape =
    await scrapeWithFirecrawl(url);

  const finalUrl =
    scrape.metadata.sourceURL || url;

  const title =
    scrape.metadata.title
      ? cleanText(
          scrape.metadata.title
        )
      : null;

  const description =
    scrape.metadata.description
      ? cleanText(
          scrape.metadata.description
        )
      : null;

  const h1 = extractTagText(
    scrape.html,
    "h1"
  );

  const h2 = extractTagText(
    scrape.html,
    "h2"
  );

  const h3 = extractTagText(
    scrape.html,
    "h3"
  );

  const images = extractImages(
    scrape.html
  );

  const links = categorizeLinks(
    scrape.links,
    finalUrl
  );

  const words = scrape.markdown
    .split(/\s+/)
    .filter(Boolean);

  const hasTitle = Boolean(title);
  const hasDescription = Boolean(
    description
  );
  const hasH1 = h1.length > 0;

  return {
    url,
    finalUrl,
    title,
    description,

    headings: { h1, h2, h3 },

    links,
    images,

    content: {
      text: scrape.markdown,
      wordCount: words.length,
      textLength:
        scrape.markdown.length,
    },

    seo: {
      hasTitle,
      hasDescription,
      hasH1,
      score: computeSeoScore(
        hasTitle,
        hasDescription,
        hasH1
      ),
    },

    analyzedAt:
      new Date().toISOString(),
  };
}

/* ========================================
   GET WEBSITE ANALYSIS (WITH FALLBACK)

   What technical-audit-agent.ts and
   content-entity-audit-agent.ts actually
   call. Tries Firecrawl first (handles
   JS-rendered pages, real markdown
   extraction, reliable metadata); on any
   failure - missing/invalid key, rate
   limit, timeout, site blocks crawlers,
   malformed response - falls back to the
   existing regex-based analyzer so an audit
   never breaks because of the Firecrawl
   integration. Same pattern as
   GoogleAnalyticsAdapter falling back to
   MockAnalyticsAdapter.
======================================== */

export async function getWebsiteAnalysis(
  url: string
): Promise<WebsiteAnalysisResult> {
  try {
    return await analyzeWebsiteWithFirecrawl(
      url
    );
  } catch (error) {
    console.warn(
      `[website-analysis] Firecrawl failed for ${url}, falling back to regex analyzer:`,
      error
    );

    return analyzeWebsite(url);
  }
}
