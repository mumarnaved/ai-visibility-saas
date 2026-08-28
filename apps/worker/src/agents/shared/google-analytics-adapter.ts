import type {
  AnalyticsAdapter,
  KeywordRanking,
  RankingsData,
  SearchConsoleData,
  SearchConsoleTrendPoint,
  SessionsData,
  SessionsTrendPoint,
} from "./analytics-adapter.js";

import {
  refreshAccessToken,
  type GoogleTokenBundle,
} from "../../lib/google-oauth-client.js";

import {
  storeCredential,
  getCredential,
} from "../../database/postgres/credential-vault/credential-vault-service.js";

/*
 * Search Console's freshest data usually
 * lags 2-3 days behind "today" - querying
 * right up to today returns mostly empty
 * rows for the last couple of days.
 */
const GSC_DATA_DELAY_DAYS = 3;

/* ========================================
   HELPERS
======================================== */

function isoDateDaysAgo(
  daysAgo: number
): string {
  const date = new Date();

  date.setUTCDate(
    date.getUTCDate() - daysAgo
  );

  return date
    .toISOString()
    .slice(0, 10);
}

function ga4DateToIso(
  value: string
): string {
  return `${value.slice(
    0,
    4
  )}-${value.slice(
    4,
    6
  )}-${value.slice(6, 8)}`;
}

/* ========================================
   GOOGLE ANALYTICS ADAPTER

   Real GA4 Data API + Search Console API
   calls for a tenant that has connected
   Google via OAuth. Same interface as
   MockAnalyticsAdapter - monitoring-agent
   decides which one to use per tenant and
   falls back to the mock on any failure.
======================================== */

export class GoogleAnalyticsAdapter
  implements AnalyticsAdapter
{
  constructor(
    private readonly tenantId: string,
    private bundle: GoogleTokenBundle
  ) {}

  /* ======================================
     ACCESS TOKEN (AUTO-REFRESH)
  ====================================== */

  private async getValidAccessToken(): Promise<string> {
    const oneMinute = 60_000;

    if (
      Date.now() <
      this.bundle.expiresAt -
        oneMinute
    ) {
      return this.bundle.accessToken;
    }

    const refreshed =
      await refreshAccessToken(
        this.bundle.refreshToken
      );

    this.bundle = {
      ...this.bundle,
      accessToken:
        refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
    };

    await storeCredential(
      this.tenantId,
      "google",
      JSON.stringify(this.bundle)
    );

    return this.bundle.accessToken;
  }

  /* ======================================
     GA4 SESSIONS
  ====================================== */

  async getSessions(
    _websiteUrl: string,
    periodDays: number
  ): Promise<SessionsData> {
    if (!this.bundle.ga4PropertyId) {
      throw new Error(
        "No GA4 property connected for this tenant."
      );
    }

    const accessToken =
      await this.getValidAccessToken();

    const periodStart =
      isoDateDaysAgo(periodDays - 1);

    const periodEnd =
      isoDateDaysAgo(0);

    const response = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${this.bundle.ga4PropertyId}:runReport`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          dateRanges: [
            {
              startDate: periodStart,
              endDate: periodEnd,
            },
          ],
          dimensions: [
            { name: "date" },
            {
              name: "sessionDefaultChannelGroup",
            },
          ],
          metrics: [
            { name: "sessions" },
          ],
        }),
      }
    );

    if (!response.ok) {
      const text =
        await response.text();

      throw new Error(
        `GA4 runReport failed (${response.status}): ${text}`
      );
    }

    const data = (await response.json()) as {
      rows?: Array<{
        dimensionValues: Array<{
          value: string;
        }>;
        metricValues: Array<{
          value: string;
        }>;
      }>;
    };

    const byDate = new Map<
      string,
      number
    >();

    let totalSessions = 0;
    let organicSessions = 0;

    for (const row of data.rows ??
      []) {
      const date = ga4DateToIso(
        row.dimensionValues[0]
          ?.value ?? ""
      );

      const channelGroup =
        row.dimensionValues[1]
          ?.value ?? "";

      const sessions = Number(
        row.metricValues[0]
          ?.value ?? 0
      );

      byDate.set(
        date,
        (byDate.get(date) ?? 0) +
          sessions
      );

      totalSessions += sessions;

      if (
        channelGroup ===
        "Organic Search"
      ) {
        organicSessions += sessions;
      }
    }

    const trend: SessionsTrendPoint[] =
      Array.from(
        byDate.entries()
      )
        .sort(([a], [b]) =>
          a.localeCompare(b)
        )
        .map(([date, sessions]) => ({
          date,
          sessions,
        }));

    return {
      source: "google-analytics",
      isSynthetic: false,
      periodStart,
      periodEnd,
      totalSessions,
      organicSessions,
      trend,
    };
  }

  /* ======================================
     SEARCH CONSOLE PERFORMANCE
  ====================================== */

  async getSearchConsoleData(
    _websiteUrl: string,
    periodDays: number
  ): Promise<SearchConsoleData> {
    if (!this.bundle.gscSiteUrl) {
      throw new Error(
        "No Search Console site connected for this tenant."
      );
    }

    const accessToken =
      await this.getValidAccessToken();

    const periodEnd = isoDateDaysAgo(
      GSC_DATA_DELAY_DAYS
    );

    const periodStart = isoDateDaysAgo(
      GSC_DATA_DELAY_DAYS +
        periodDays -
        1
    );

    const rows =
      await this.querySearchConsole(
        accessToken,
        periodStart,
        periodEnd,
        ["date"]
      );

    const trend: SearchConsoleTrendPoint[] =
      rows.map((row) => ({
        date: row.keys[0] ?? "",
        clicks: row.clicks,
        impressions:
          row.impressions,
      }));

    const totalClicks = rows.reduce(
      (sum, row) =>
        sum + row.clicks,
      0
    );

    const totalImpressions =
      rows.reduce(
        (sum, row) =>
          sum + row.impressions,
        0
      );

    const positionWeightedSum =
      rows.reduce(
        (sum, row) =>
          sum +
          row.position *
            row.impressions,
        0
      );

    return {
      source:
        "google-search-console",
      isSynthetic: false,
      periodStart,
      periodEnd,
      totalClicks,
      totalImpressions,
      averageCtr:
        totalImpressions > 0
          ? Number(
              (
                (totalClicks /
                  totalImpressions) *
                100
              ).toFixed(2)
            )
          : 0,
      averagePosition:
        totalImpressions > 0
          ? Number(
              (
                positionWeightedSum /
                totalImpressions
              ).toFixed(1)
            )
          : 0,
      trend,
    };
  }

  /* ======================================
     KEYWORD RANKINGS

     Matches tracked keywords against actual
     Search Console query data - current
     period vs. the equal-length period
     before it, for "previousPosition".
     Keywords with no real impression data
     are omitted rather than fabricated.
  ====================================== */

  async getRankings(
    _websiteUrl: string,
    keywords: string[]
  ): Promise<RankingsData> {
    if (!this.bundle.gscSiteUrl) {
      throw new Error(
        "No Search Console site connected for this tenant."
      );
    }

    if (keywords.length === 0) {
      return {
        source:
          "google-search-console",
        isSynthetic: false,
        keywords: [],
      };
    }

    const accessToken =
      await this.getValidAccessToken();

    const currentEnd = isoDateDaysAgo(
      GSC_DATA_DELAY_DAYS
    );

    const currentStart =
      isoDateDaysAgo(
        GSC_DATA_DELAY_DAYS + 27
      );

    const previousEnd =
      isoDateDaysAgo(
        GSC_DATA_DELAY_DAYS + 28
      );

    const previousStart =
      isoDateDaysAgo(
        GSC_DATA_DELAY_DAYS + 55
      );

    const [
      currentRows,
      previousRows,
    ] = await Promise.all([
      this.queryKeywordPositions(
        accessToken,
        currentStart,
        currentEnd,
        keywords
      ),
      this.queryKeywordPositions(
        accessToken,
        previousStart,
        previousEnd,
        keywords
      ),
    ]);

    const rankings: KeywordRanking[] =
      [];

    for (const keyword of keywords) {
      const current =
        currentRows.get(
          keyword.toLowerCase()
        );

      if (!current) {
        continue;
      }

      const previous =
        previousRows.get(
          keyword.toLowerCase()
        );

      rankings.push({
        keyword,
        position: Math.round(
          current
        ),
        previousPosition:
          previous
            ? Math.round(
                previous
              )
            : null,
      });
    }

    if (rankings.length > 0) {
      return {
        source:
          "google-search-console",
        isSynthetic: false,
        keywords: rankings,
      };
    }

    /*
     * Tracked keywords are conversational
     * AI-visibility queries (e.g. "what is
     * nexflow?") and essentially never
     * literally appear in GSC's real search
     * query data, which is short/fragment-
     * style ("nexflow", "nexflow pricing").
     * An empty section is less useful than
     * real data, so fall back to the site's
     * actual top queries by impressions.
     */
    return this.getTopSearchConsoleQueries(
      accessToken,
      currentStart,
      currentEnd,
      previousStart,
      previousEnd
    );
  }

  private async getTopSearchConsoleQueries(
    accessToken: string,
    currentStart: string,
    currentEnd: string,
    previousStart: string,
    previousEnd: string
  ): Promise<RankingsData> {
    const [
      currentRows,
      previousRows,
    ] = await Promise.all([
      this.querySearchConsole(
        accessToken,
        currentStart,
        currentEnd,
        ["query"]
      ),
      this.querySearchConsole(
        accessToken,
        previousStart,
        previousEnd,
        ["query"]
      ),
    ]);

    const previousByQuery = new Map(
      previousRows.map((row) => [
        (
          row.keys[0] ?? ""
        ).toLowerCase(),
        row.position,
      ])
    );

    const topQueries: KeywordRanking[] =
      [...currentRows]
        .sort(
          (a, b) =>
            b.impressions -
            a.impressions
        )
        .slice(0, 5)
        .map((row) => {
          const query =
            row.keys[0] ?? "";

          const previous =
            previousByQuery.get(
              query.toLowerCase()
            );

          return {
            keyword: query,
            position: Math.round(
              row.position
            ),
            previousPosition:
              previous !== undefined
                ? Math.round(
                    previous
                  )
                : null,
          };
        });

    return {
      source: "google-search-console",
      isSynthetic: false,
      keywords: topQueries,
    };
  }

  /* ======================================
     SEARCH CONSOLE QUERY HELPERS
  ====================================== */

  private async querySearchConsole(
    accessToken: string,
    startDate: string,
    endDate: string,
    dimensions: string[]
  ): Promise<
    Array<{
      keys: string[];
      clicks: number;
      impressions: number;
      position: number;
    }>
  > {
    const response = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
        this.bundle.gscSiteUrl!
      )}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions,
          rowLimit: 1000,
        }),
      }
    );

    if (!response.ok) {
      const text =
        await response.text();

      throw new Error(
        `Search Console query failed (${response.status}): ${text}`
      );
    }

    const data = (await response.json()) as {
      rows?: Array<{
        keys: string[];
        clicks: number;
        impressions: number;
        ctr: number;
        position: number;
      }>;
    };

    return data.rows ?? [];
  }

  private async queryKeywordPositions(
    accessToken: string,
    startDate: string,
    endDate: string,
    keywords: string[]
  ): Promise<Map<string, number>> {
    const response = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
        this.bundle.gscSiteUrl!
      )}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions: ["query"],
          dimensionFilterGroups:
            keywords.map(
              (keyword) => ({
                filters: [
                  {
                    dimension:
                      "query",
                    operator:
                      "contains",
                    expression:
                      keyword,
                  },
                ],
              })
            ),
          rowLimit: 1000,
        }),
      }
    );

    if (!response.ok) {
      const text =
        await response.text();

      throw new Error(
        `Search Console keyword query failed (${response.status}): ${text}`
      );
    }

    const data = (await response.json()) as {
      rows?: Array<{
        keys: string[];
        impressions: number;
        position: number;
      }>;
    };

    const positions = new Map<
      string,
      number
    >();

    for (const row of data.rows ??
      []) {
      const query = (
        row.keys[0] ?? ""
      ).toLowerCase();

      const matchedKeyword =
        keywords.find((keyword) =>
          query.includes(
            keyword.toLowerCase()
          )
        );

      if (
        !matchedKeyword ||
        row.impressions === 0
      ) {
        continue;
      }

      const key =
        matchedKeyword.toLowerCase();

      const existing =
        positions.get(key);

      /*
       * Multiple actual GSC queries can
       * match one tracked keyword (e.g.
       * "best crm" and "best crm 2026") -
       * keep the best (lowest) position.
       */
      if (
        existing === undefined ||
        row.position < existing
      ) {
        positions.set(
          key,
          row.position
        );
      }
    }

    return positions;
  }
}

/* ========================================
   FACTORY

   Returns null (never throws) when the
   tenant hasn't connected Google or the
   stored credential is unreadable - callers
   fall back to MockAnalyticsAdapter.
======================================== */

export async function createGoogleAnalyticsAdapter(
  tenantId: string
): Promise<GoogleAnalyticsAdapter | null> {
  const raw = await getCredential(
    tenantId,
    "google"
  );

  if (!raw) {
    return null;
  }

  try {
    const bundle = JSON.parse(
      raw
    ) as GoogleTokenBundle;

    if (
      !bundle.accessToken ||
      !bundle.refreshToken
    ) {
      return null;
    }

    return new GoogleAnalyticsAdapter(
      tenantId,
      bundle
    );
  } catch {
    return null;
  }
}
