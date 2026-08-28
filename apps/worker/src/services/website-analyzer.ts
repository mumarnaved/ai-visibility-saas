export interface WebsiteAnalysisResult {
  url: string;
  finalUrl: string;
  title: string | null;
  description: string | null;

  headings: {
    h1: string[];
    h2: string[];
    h3: string[];
  };

  links: {
    total: number;
    internal: number;
    external: number;
  };

  images: {
    total: number;
    withAlt: number;
    withoutAlt: number;
  };

  content: {
    text: string;
    wordCount: number;
    textLength: number;
  };

  seo: {
    hasTitle: boolean;
    hasDescription: boolean;
    hasH1: boolean;
    score: number;
  };

  analyzedAt: string;
}

/* ========================================
   NORMALIZE URL
======================================== */

export function normalizeUrl(
  url: string
): string {
  const trimmed =
    url.trim();

  if (!trimmed) {
    throw new Error(
      "Website URL is required."
    );
  }

  const parsed =
    new URL(trimmed);

  if (
    !["http:", "https:"].includes(
      parsed.protocol
    )
  ) {
    throw new Error(
      "Only HTTP and HTTPS URLs are supported."
    );
  }

  return parsed.toString();
}

/* ========================================
   CLEAN TEXT
======================================== */

export function cleanText(
  text: string
): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\n+/g, " ")
    .trim();
}

/* ========================================
   EXTRACT TAG TEXT
======================================== */

export function extractTagText(
  html: string,
  tag: string
): string[] {
  const results: string[] = [];

  const regex =
    new RegExp(
      `<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`,
      "gi"
    );

  let match:
    RegExpExecArray | null;

  while (
    (match = regex.exec(html)) !== null
  ) {
    const value =
      cleanText(
        match[1]
          .replace(
            /<[^>]+>/g,
            " "
          )
          .replace(
            /&nbsp;/gi,
            " "
          )
          .replace(
            /&amp;/gi,
            "&"
          )
          .replace(
            /&lt;/gi,
            "<"
          )
          .replace(
            /&gt;/gi,
            ">"
          )
          .replace(
            /&quot;/gi,
            '"'
          )
      );

    if (value) {
      results.push(value);
    }
  }

  return results;
}

/* ========================================
   EXTRACT META DESCRIPTION
======================================== */

function extractMetaDescription(
  html: string
): string | null {
  const regex =
    /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i;

  const reverseRegex =
    /<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i;

  const match =
    html.match(regex) ??
    html.match(reverseRegex);

  return match?.[1]
    ? cleanText(match[1])
    : null;
}

/* ========================================
   EXTRACT LINKS
======================================== */

function extractLinks(
  html: string,
  baseUrl: string
): {
  total: number;
  internal: number;
  external: number;
} {
  const regex =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;

  const base =
    new URL(baseUrl);

  let total = 0;
  let internal = 0;
  let external = 0;

  let match:
    RegExpExecArray | null;

  while (
    (match = regex.exec(html)) !== null
  ) {
    const href =
      match[1].trim();

    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("javascript:")
    ) {
      continue;
    }

    try {
      const linkUrl =
        new URL(
          href,
          base
        );

      total++;

      if (
        linkUrl.hostname ===
        base.hostname
      ) {
        internal++;
      } else {
        external++;
      }
    } catch {
      // Ignore invalid URLs.
    }
  }

  return {
    total,
    internal,
    external,
  };
}

/* ========================================
   EXTRACT IMAGES
======================================== */

export function extractImages(
  html: string
): {
  total: number;
  withAlt: number;
  withoutAlt: number;
} {
  const regex =
    /<img\b[^>]*>/gi;

  const images =
    html.match(regex) ?? [];

  let withAlt = 0;
  let withoutAlt = 0;

  for (
    const image of images
  ) {
    const altMatch =
      image.match(
        /\balt=["']([^"']*)["']/i
      );

    if (
      altMatch &&
      altMatch[1]
        .trim()
        .length > 0
    ) {
      withAlt++;
    } else {
      withoutAlt++;
    }
  }

  return {
    total: images.length,
    withAlt,
    withoutAlt,
  };
}

/* ========================================
   COMPUTE SEO SCORE

   Shared by the regex analyzer and the
   Firecrawl-backed analyzer so both paths
   produce comparably-scored results.
======================================== */

export function computeSeoScore(
  hasTitle: boolean,
  hasDescription: boolean,
  hasH1: boolean
): number {
  let score = 0;

  if (hasTitle) {
    score += 35;
  }

  if (hasDescription) {
    score += 30;
  }

  if (hasH1) {
    score += 35;
  }

  return score;
}

/* ========================================
   EXTRACT BODY TEXT
======================================== */

function extractBodyText(
  html: string
): string {
  return cleanText(
    html
      .replace(
        /<script\b[^>]*>[\s\S]*?<\/script>/gi,
        " "
      )
      .replace(
        /<style\b[^>]*>[\s\S]*?<\/style>/gi,
        " "
      )
      .replace(
        /<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,
        " "
      )
      .replace(
        /<[^>]+>/g,
        " "
      )
      .replace(
        /&nbsp;/gi,
        " "
      )
      .replace(
        /&amp;/gi,
        "&"
      )
      .replace(
        /&lt;/gi,
        "<"
      )
      .replace(
        /&gt;/gi,
        ">"
      )
      .replace(
        /&quot;/gi,
        '"'
      )
  );
}

/* ========================================
   ANALYZE WEBSITE
======================================== */

export async function analyzeWebsite(
  inputUrl: string
): Promise<WebsiteAnalysisResult> {
  const url =
    normalizeUrl(inputUrl);

  const response =
    await fetch(
      url,
      {
        headers: {
          "User-Agent":
            "AI-Visibility-Analyzer/1.0",

          Accept:
            "text/html,application/xhtml+xml",
        },

        redirect: "follow",
      }
    );

  if (!response.ok) {
    throw new Error(
      `Website returned HTTP ${response.status}.`
    );
  }

  const contentType =
    response.headers.get(
      "content-type"
    ) ?? "";

  if (
    !contentType.includes(
      "text/html"
    ) &&
    !contentType.includes(
      "application/xhtml+xml"
    )
  ) {
    throw new Error(
      "The provided URL did not return an HTML page."
    );
  }

  const html =
    await response.text();

  const finalUrl =
    response.url || url;

  /* ========================================
     EXTRACT PAGE DATA
  ======================================== */

  const titleValues =
    extractTagText(
      html,
      "title"
    );

  const h1 =
    extractTagText(
      html,
      "h1"
    );

  const h2 =
    extractTagText(
      html,
      "h2"
    );

  const h3 =
    extractTagText(
      html,
      "h3"
    );

  const description =
    extractMetaDescription(
      html
    );

  const bodyText =
    extractBodyText(
      html
    );

  const words =
    bodyText
      .split(/\s+/)
      .filter(Boolean);

  const links =
    extractLinks(
      html,
      finalUrl
    );

  const images =
    extractImages(
      html
    );

  const title =
    titleValues.length > 0
      ? titleValues[0]
      : null;

  const hasTitle =
    Boolean(title);

  const hasDescription =
    Boolean(description);

  const hasH1 =
    h1.length > 0;

  const seoScore =
    computeSeoScore(
      hasTitle,
      hasDescription,
      hasH1
    );

  /* ========================================
     RETURN ANALYSIS
  ======================================== */

  return {
    url,

    finalUrl,

    title,

    description,

    headings: {
      h1,
      h2,
      h3,
    },

    links,

    images,

    content: {
      text: bodyText,
      wordCount:
        words.length,
      textLength:
        bodyText.length,
    },

    seo: {
      hasTitle,
      hasDescription,
      hasH1,
      score: seoScore,
    },

    analyzedAt:
      new Date().toISOString(),
  };
}