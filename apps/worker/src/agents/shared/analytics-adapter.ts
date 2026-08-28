/* ========================================
   ANALYTICS ADAPTER

   Stage 4 (monitoring and report-generation
   agents) talk to analytics/search-console/
   rank-tracking data only through this
   interface. No GA4, Google Search Console,
   GTM, or DataForSEO connection exists yet,
   so MockAnalyticsAdapter below is the
   default implementation - it returns
   plausible synthetic trend data, clearly
   flagged as such (source/isSynthetic on
   every payload) rather than pretending to
   be real measurements. Swapping in a real
   provider later means writing a class that
   implements AnalyticsAdapter and passing it
   into the agent constructor - no agent code
   changes required. Mirrors the CmsAdapter /
   MockCmsAdapter pattern from Stage 3.
======================================== */

export interface SessionsTrendPoint {
  date: string;
  sessions: number;
}

export interface SessionsData {
  source: string;
  isSynthetic: boolean;
  periodStart: string;
  periodEnd: string;
  totalSessions: number;
  organicSessions: number;
  trend: SessionsTrendPoint[];
}

export interface SearchConsoleTrendPoint {
  date: string;
  clicks: number;
  impressions: number;
}

export interface SearchConsoleData {
  source: string;
  isSynthetic: boolean;
  periodStart: string;
  periodEnd: string;
  totalClicks: number;
  totalImpressions: number;
  averageCtr: number;
  averagePosition: number;
  trend: SearchConsoleTrendPoint[];
}

export interface KeywordRanking {
  keyword: string;
  position: number;
  previousPosition: number | null;
}

export interface RankingsData {
  source: string;
  isSynthetic: boolean;
  keywords: KeywordRanking[];
}

export interface AnalyticsAdapter {
  getSessions(
    websiteUrl: string,
    periodDays: number
  ): Promise<SessionsData>;

  getSearchConsoleData(
    websiteUrl: string,
    periodDays: number
  ): Promise<SearchConsoleData>;

  getRankings(
    websiteUrl: string,
    keywords: string[]
  ): Promise<RankingsData>;
}

/* ========================================
   MOCK ANALYTICS ADAPTER
======================================== */

const MOCK_SOURCE = "mock-analytics";

/*
 * Deterministic per-website "random" so
 * repeated calls for the same site produce
 * a stable-but-varying series instead of
 * pure noise on every run.
 */
function seededRandom(seed: string): () => number {
  let state = 0;

  for (let i = 0; i < seed.length; i++) {
    state =
      (state * 31 + seed.charCodeAt(i)) >>>
      0;
  }

  return () => {
    state =
      (state * 1103515245 + 12345) >>> 0;

    return (state % 10000) / 10000;
  };
}

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

export class MockAnalyticsAdapter
  implements AnalyticsAdapter
{
  async getSessions(
    websiteUrl: string,
    periodDays: number
  ): Promise<SessionsData> {
    const random = seededRandom(
      `sessions:${websiteUrl}`
    );

    const trend: SessionsTrendPoint[] =
      [];

    let totalSessions = 0;
    let baseline = 80 + random() * 120;

    for (
      let day = periodDays - 1;
      day >= 0;
      day--
    ) {
      baseline +=
        (random() - 0.45) * 8;

      baseline = Math.max(
        10,
        baseline
      );

      const sessions = Math.round(
        baseline
      );

      totalSessions += sessions;

      trend.push({
        date:
          isoDateDaysAgo(day),
        sessions,
      });
    }

    return {
      source: MOCK_SOURCE,
      isSynthetic: true,
      periodStart:
        isoDateDaysAgo(
          periodDays - 1
        ),
      periodEnd:
        isoDateDaysAgo(0),
      totalSessions,
      organicSessions: Math.round(
        totalSessions * 0.62
      ),
      trend,
    };
  }

  async getSearchConsoleData(
    websiteUrl: string,
    periodDays: number
  ): Promise<SearchConsoleData> {
    const random = seededRandom(
      `search-console:${websiteUrl}`
    );

    const trend: SearchConsoleTrendPoint[] =
      [];

    let totalClicks = 0;
    let totalImpressions = 0;
    let positionSum = 0;

    let clickBaseline =
      15 + random() * 25;

    let impressionBaseline =
      clickBaseline * (8 + random() * 6);

    for (
      let day = periodDays - 1;
      day >= 0;
      day--
    ) {
      clickBaseline = Math.max(
        1,
        clickBaseline +
          (random() - 0.45) * 3
      );

      impressionBaseline = Math.max(
        clickBaseline,
        impressionBaseline +
          (random() - 0.45) * 20
      );

      const clicks = Math.round(
        clickBaseline
      );

      const impressions = Math.round(
        impressionBaseline
      );

      totalClicks += clicks;
      totalImpressions += impressions;

      positionSum +=
        6 + random() * 18;

      trend.push({
        date:
          isoDateDaysAgo(day),
        clicks,
        impressions,
      });
    }

    return {
      source: MOCK_SOURCE,
      isSynthetic: true,
      periodStart:
        isoDateDaysAgo(
          periodDays - 1
        ),
      periodEnd:
        isoDateDaysAgo(0),
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
      averagePosition: Number(
        (
          positionSum / periodDays
        ).toFixed(1)
      ),
      trend,
    };
  }

  async getRankings(
    websiteUrl: string,
    keywords: string[]
  ): Promise<RankingsData> {
    const targetKeywords =
      keywords.length > 0
        ? keywords
        : [websiteUrl];

    const rankings: KeywordRanking[] =
      targetKeywords.map(
        (keyword) => {
          const random = seededRandom(
            `ranking:${websiteUrl}:${keyword}`
          );

          const previousPosition =
            Math.round(
              5 + random() * 40
            );

          const drift = Math.round(
            (random() - 0.5) * 8
          );

          const position = Math.max(
            1,
            previousPosition + drift
          );

          return {
            keyword,
            position,
            previousPosition,
          };
        }
      );

    return {
      source: MOCK_SOURCE,
      isSynthetic: true,
      keywords: rankings,
    };
  }
}
