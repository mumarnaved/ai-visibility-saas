export interface WebsiteCrawlResult {
  url: string;
  finalUrl: string;
  title: string | null;
  description: string | null;
  text: string;
  links: string[];
}

function extractTitle(html: string): string | null {
  const match = html.match(
    /<title[^>]*>([\s\S]*?)<\/title>/i
  );

  if (!match?.[1]) {
    return null;
  }

  return match[1].replace(/\s+/g, " ").trim() || null;
}

function extractDescription(
  html: string
): string | null {
  const match = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i
  );

  if (!match?.[1]) {
    return null;
  }

  return (
    match[1].replace(/\s+/g, " ").trim() || null
  );
}

function extractText(html: string): string {
  return html
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
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinks(
  html: string,
  baseUrl: string
): string[] {
  const links = new Set<string>();

  const regex =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;

  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const href = match[1]?.trim();

    if (!href) {
      continue;
    }

    try {
      const absoluteUrl = new URL(
        href,
        baseUrl
      ).toString();

      if (
        absoluteUrl.startsWith("http://") ||
        absoluteUrl.startsWith("https://")
      ) {
        links.add(absoluteUrl);
      }
    } catch {
      // Ignore invalid URLs.
    }
  }

  return Array.from(links);
}

export async function crawlWebsite(
  url: string
): Promise<WebsiteCrawlResult> {
  const parsedUrl = new URL(url);

  if (
    parsedUrl.protocol !== "http:" &&
    parsedUrl.protocol !== "https:"
  ) {
    throw new Error(
      "Website URL must use HTTP or HTTPS."
    );
  }

  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "AI-Visibility-Bot/1.0 (+website-analysis)",
      Accept:
        "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Website returned HTTP ${response.status}.`
    );
  }

  const contentType =
    response.headers.get("content-type") || "";

  if (!contentType.includes("text/html")) {
    throw new Error(
      "The provided URL did not return an HTML page."
    );
  }

  const html = await response.text();

  if (!html.trim()) {
    throw new Error(
      "The website returned an empty response."
    );
  }

  const finalUrl = response.url;

  return {
    url,
    finalUrl,
    title: extractTitle(html),
    description: extractDescription(html),
    text: extractText(html),
    links: extractLinks(html, finalUrl),
  };
}