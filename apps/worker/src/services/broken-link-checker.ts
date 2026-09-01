/* ========================================
   BROKEN LINK CHECKER

   Checks a bounded set of internal links
   for dead/broken responses (404, 500, or a
   connection failure/timeout). Scoped to
   internal links only - those are the ones
   the tenant can actually fix, and checking
   arbitrary third-party sites at scale from
   our infra isn't something to do by
   default.

   Bounded by design so this can run inline
   as part of the technical audit without
   materially slowing it down: capped link
   count, limited concurrency, and a short
   per-link timeout.
======================================== */

const MAX_LINKS_TO_CHECK = 25;

const CONCURRENCY = 5;

const CHECK_TIMEOUT_MS = 5000;

const USER_AGENT =
  "AI-Visibility-Broken-Link-Checker/1.0";

export interface BrokenLinkCheckResult {
  url: string;

  /*
   * The HTTP status actually observed, or
   * null when the request never got a
   * response at all (timeout / connection
   * failure).
   */
  status: number | null;

  broken: boolean;

  /*
   * Human-readable reason, set only when
   * broken is true.
   */
  reason?: string;
}

/* ========================================
   CHECK SINGLE LINK

   HEAD first (cheaper - no response body
   to transfer) - falls back to GET only
   when the server doesn't support HEAD
   properly (405/501), since some servers
   mishandle or block it outright.
======================================== */

async function fetchWithTimeout(
  url: string,
  method: "HEAD" | "GET"
): Promise<Response> {
  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    CHECK_TIMEOUT_MS
  );

  try {
    return await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,

      headers: {
        "User-Agent": USER_AGENT,
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function checkSingleLink(
  url: string
): Promise<BrokenLinkCheckResult> {
  try {
    let response =
      await fetchWithTimeout(
        url,
        "HEAD"
      );

    if (
      response.status === 405 ||
      response.status === 501
    ) {
      response =
        await fetchWithTimeout(
          url,
          "GET"
        );
    }

    const broken =
      response.status === 404 ||
      response.status === 500;

    return {
      url,
      status: response.status,

      broken,

      reason: broken
        ? `HTTP ${response.status}`
        : undefined,
    };
  } catch (error) {
    const isTimeout =
      error instanceof Error &&
      error.name === "AbortError";

    return {
      url,
      status: null,
      broken: true,

      reason: isTimeout
        ? "Timed out"
        : "Failed to connect",
    };
  }
}

/* ========================================
   CHECK BROKEN LINKS

   Deduplicates and caps the input to
   MAX_LINKS_TO_CHECK before checking
   anything, then runs CONCURRENCY requests
   at a time.
======================================== */

export async function checkBrokenLinks(
  urls: string[]
): Promise<BrokenLinkCheckResult[]> {
  const targets = [
    ...new Set(urls),
  ].slice(0, MAX_LINKS_TO_CHECK);

  const results: BrokenLinkCheckResult[] =
    [];

  for (
    let index = 0;
    index < targets.length;
    index += CONCURRENCY
  ) {
    const batch = targets.slice(
      index,
      index + CONCURRENCY
    );

    const batchResults =
      await Promise.all(
        batch.map(checkSingleLink)
      );

    results.push(...batchResults);
  }

  return results;
}
