"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { toast } from "sonner";

import { authFetch } from "@/lib/auth";
import {
  loadActiveTenant,
  type TenantSummary,
} from "@/lib/tenant";
import Modal from "@/components/Modal";
import CountUpNumber from "@/components/CountUpNumber";
import EmptyState from "@/components/EmptyState";
import {
  SkeletonCard,
  SkeletonStat,
} from "@/components/Skeleton";

const WORKER_API =
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4000";

/* ========================================
   TYPES
======================================== */

type Tenant = TenantSummary;

type TrendPoint = {
  date: string;
  sessions?: number;
  clicks?: number;
  impressions?: number;
};

type SessionsData = {
  source: string;
  isSynthetic: boolean;
  periodStart: string;
  periodEnd: string;
  totalSessions: number;
  organicSessions: number;
  trend: TrendPoint[];
};

type SearchConsoleData = {
  source: string;
  isSynthetic: boolean;
  periodStart: string;
  periodEnd: string;
  totalClicks: number;
  totalImpressions: number;
  averageCtr: number;
  averagePosition: number;
  trend: TrendPoint[];
};

type KeywordRanking = {
  keyword: string;
  position: number;
  previousPosition: number | null;
};

type RankingsData = {
  source: string;
  isSynthetic: boolean;
  keywords: KeywordRanking[];
};

type MonitoringInsight = {
  type: string;
  message: string;
};

type SnapshotMetrics = {
  sessions?: SessionsData;
  searchConsole?: SearchConsoleData;
  rankings?: RankingsData;
  publishedTaskCount?: number;
  insights?: MonitoringInsight[];
};

type MonitoringSnapshot = {
  id: string;
  snapshotDate: string;
  visibilityScore: number | null;
  citationScore: number | null;
  technicalScore: number | null;
  contentScore: number | null;
  competitorScore: number | null;
  metrics: SnapshotMetrics | null;
  createdAt: string;
};

type MonitoringResponse = {
  success: boolean;
  data?: MonitoringSnapshot | null;
  error?: string;
};

type ScoreDelta = {
  current: number | null;
  previous: number | null;
  delta: number | null;
};

type AuditDeltas = {
  overallScore: ScoreDelta;
  technicalSeoScore: ScoreDelta;
  contentQualityScore: ScoreDelta;
  aioReadinessScore: ScoreDelta;
  geoCitationScore: ScoreDelta;
  competitorGapScore: ScoreDelta;
};

type PlanProgress = {
  hasPlan: boolean;
  approvalStatus: string | null;
  totalTasks: number;
  tasksByStatus: Record<string, number>;
  tasksByApproval: Record<
    string,
    number
  >;
};

type Report = {
  id: string;
  periodStart: string;
  periodEnd: string;
  summary: string | null;
  auditDeltas: AuditDeltas;
  planProgress: PlanProgress;
  trafficTrend: unknown;
  recommendations: string[];
  createdAt: string;
};

type ReportResponse = {
  success: boolean;
  data?: Report | null;
  error?: string;
};

type MutationResponse = {
  success: boolean;
  error?: string;
};

type GoogleStatus = {
  connected: boolean;
  ga4PropertyId?: string | null;
  gscSiteUrl?: string | null;
  connectedAt?: string | null;
  discoveryIssues?: string[];
};

type GoogleStatusResponse = {
  success: boolean;
  data?: GoogleStatus;
  error?: string;
};

type GoogleStartResponse = {
  success: boolean;
  data?: { authUrl: string };
  error?: string;
};

/* ========================================
   HELPERS
======================================== */

const INSIGHT_BADGE: Record<
  string,
  string
> = {
  ranking_up_traffic_flat:
    "bg-warning-bg text-warning-text",
  ranking_improved:
    "bg-success-bg text-success-text",
  changes_published:
    "bg-info-bg text-info-text",
  no_changes_published:
    "bg-muted text-ink-secondary",
};

function isMissingDataError(
  message: string
): boolean {
  return (
    message.startsWith(
      "No audit report found"
    ) ||
    message.startsWith(
      "No monitoring data found"
    )
  );
}

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatDelta(
  delta: ScoreDelta
): string {
  if (delta.delta === null) {
    return "No prior audit to compare";
  }

  if (delta.delta === 0) {
    return "No change";
  }

  const sign =
    delta.delta > 0 ? "+" : "";

  return `${sign}${delta.delta} (${delta.previous} → ${delta.current})`;
}

function Sparkline({
  points,
  valueKey,
}: {
  points: TrendPoint[];
  valueKey: "sessions" | "clicks";
}) {
  const values = points.map(
    (point) => point[valueKey] ?? 0
  );

  const max = Math.max(1, ...values);

  return (
    <div className="mt-4 flex h-12 items-end gap-1">
      {values.map((value, index) => (
        <div
          key={index}
          className="flex-1 rounded-sm bg-primary/60"
          style={{
            height: `${Math.max(
              6,
              (value / max) * 100
            )}%`,
          }}
        />
      ))}
    </div>
  );
}

function SyntheticBadge() {
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
      Synthetic (mock)
    </span>
  );
}

/* ========================================
   PAGE
======================================== */

export default function MonitoringPage() {
  const router = useRouter();

  const [tenant, setTenant] =
    useState<Tenant | null>(null);

  const [googleStatus, setGoogleStatus] =
    useState<GoogleStatus | null>(
      null
    );

  const [connectingGoogle, setConnectingGoogle] =
    useState(false);

  const [disconnectingGoogle, setDisconnectingGoogle] =
    useState(false);

  const [snapshot, setSnapshot] =
    useState<MonitoringSnapshot | null>(
      null
    );

  const [report, setReport] =
    useState<Report | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] = useState("");

  const [monitoring, setMonitoring] =
    useState(false);

  const [generating, setGenerating] =
    useState(false);

  const [viewingReport, setViewingReport] =
    useState(false);

  /* ========================================
     LOAD
  ======================================== */

  async function loadResults(
    currentTenant?: Tenant
  ) {
    const activeTenant =
      currentTenant ?? tenant;

    if (!activeTenant) {
      return;
    }

    const [
      snapshotResponse,
      reportResponse,
      googleStatusResponse,
    ] = await Promise.all([
      authFetch(
        `${WORKER_API}/api/tenants/${activeTenant.id}/monitoring/latest`,
        { cache: "no-store" }
      ),
      authFetch(
        `${WORKER_API}/api/tenants/${activeTenant.id}/reports/latest`,
        { cache: "no-store" }
      ),
      authFetch(
        `${WORKER_API}/api/tenants/${activeTenant.id}/oauth/google/status`,
        { cache: "no-store" }
      ),
    ]);

    if (!snapshotResponse.ok) {
      throw new Error(
        `Monitoring API returned ${snapshotResponse.status}`
      );
    }

    if (!reportResponse.ok) {
      throw new Error(
        `Reports API returned ${reportResponse.status}`
      );
    }

    if (!googleStatusResponse.ok) {
      throw new Error(
        `Google status API returned ${googleStatusResponse.status}`
      );
    }

    const snapshotResult: MonitoringResponse =
      await snapshotResponse.json();

    const reportResult: ReportResponse =
      await reportResponse.json();

    const googleStatusResult: GoogleStatusResponse =
      await googleStatusResponse.json();

    if (!snapshotResult.success) {
      throw new Error(
        snapshotResult.error ||
          "Unable to load monitoring data."
      );
    }

    if (!reportResult.success) {
      throw new Error(
        reportResult.error ||
          "Unable to load report."
      );
    }

    if (!googleStatusResult.success) {
      throw new Error(
        googleStatusResult.error ||
          "Unable to load Google connection status."
      );
    }

    setSnapshot(
      snapshotResult.data ?? null
    );

    setReport(reportResult.data ?? null);

    setGoogleStatus(
      googleStatusResult.data ?? null
    );
  }

  async function loadPage() {
    try {
      setLoading(true);
      setError("");

      const { tenant: activeTenant } =
        await loadActiveTenant(
          WORKER_API
        );

      if (!activeTenant) {
        throw new Error(
          "No workspace found. Create one to get started."
        );
      }

      setTenant(activeTenant);

      await loadResults(activeTenant);
    } catch (err) {
      console.error(
        "Failed to load monitoring page:",
        err
      );

      setError(
        err instanceof Error
          ? err.message
          : "Unable to load monitoring data."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ========================================
     GOOGLE OAUTH REDIRECT NOTICE

     After Google redirects back to this page
     (?google=connected or ?google=error), show
     a one-time notice and strip the param so
     it doesn't reappear on refresh.
  ======================================== */

  useEffect(() => {
    const params =
      new URLSearchParams(
        window.location.search
      );

    const googleParam =
      params.get("google");

    if (!googleParam) {
      return;
    }

    if (googleParam === "connected") {
      toast.success(
        "Google account connected."
      );

      loadResults();
    } else if (
      googleParam === "error"
    ) {
      const reason =
        params.get("reason");

      toast.error(
        reason === "denied"
          ? "Google connection was cancelled."
          : `Failed to connect Google${
              reason
                ? `: ${reason}`
                : "."
            }`
      );
    }

    router.replace("/monitoring");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ========================================
     ACTIONS
  ======================================== */

  async function connectGoogle() {
    if (!tenant) {
      return;
    }

    setConnectingGoogle(true);

    try {
      const response = await authFetch(
        `${WORKER_API}/api/tenants/${tenant.id}/oauth/google/start`,
        { cache: "no-store" }
      );

      const result: GoogleStartResponse =
        await response.json();

      if (
        !response.ok ||
        !result.success ||
        !result.data
      ) {
        throw new Error(
          result.error ||
            "Failed to start Google connection."
        );
      }

      window.location.href =
        result.data.authUrl;
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to start Google connection."
      );

      setConnectingGoogle(false);
    }
  }

  async function disconnectGoogle() {
    if (!tenant) {
      return;
    }

    setDisconnectingGoogle(true);

    try {
      const response = await authFetch(
        `${WORKER_API}/api/tenants/${tenant.id}/oauth/google/disconnect`,
        { method: "POST" }
      );

      const result: MutationResponse =
        await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ||
            "Failed to disconnect Google."
        );
      }

      await loadResults();

      toast.success(
        "Google account disconnected."
      );
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to disconnect Google."
      );
    } finally {
      setDisconnectingGoogle(false);
    }
  }

  async function runMonitoring() {
    if (!tenant) {
      return;
    }

    setMonitoring(true);

    try {
      const response = await authFetch(
        `${WORKER_API}/api/tenants/${tenant.id}/stage4-monitor`,
        { method: "POST" }
      );

      const result: MutationResponse =
        await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ||
            "Monitoring run failed."
        );
      }

      await loadResults();

      toast.success(
        "Monitoring check completed."
      );
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Monitoring run failed.";

      if (isMissingDataError(message)) {
        toast(message);
      } else {
        toast.error(message);
      }
    } finally {
      setMonitoring(false);
    }
  }

  async function generateReport() {
    if (!tenant) {
      return;
    }

    setGenerating(true);

    try {
      const response = await authFetch(
        `${WORKER_API}/api/tenants/${tenant.id}/stage4-report`,
        { method: "POST" }
      );

      const result: MutationResponse =
        await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ||
            "Report generation failed."
        );
      }

      await loadResults();

      toast.success("Report generated.");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Report generation failed.";

      if (isMissingDataError(message)) {
        toast(message);
      } else {
        toast.error(message);
      }
    } finally {
      setGenerating(false);
    }
  }

  const metrics = snapshot?.metrics ?? null;

  return (
    <main className="animate-page-in min-h-screen bg-page text-ink">

      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">

        {/* ========================================
           HEADER
        ======================================== */}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {tenant?.name || "Workspace"}
            </div>

            <h1 className="mt-1 text-2xl font-bold">
              Monitoring
            </h1>

            <p className="mt-2 max-w-xl text-sm text-ink-muted">
              Track visibility signals over time
              and generate a period report — audit
              deltas, plan progress, and traffic
              trend in one place.
            </p>
          </div>

          <button
            onClick={loadPage}
            disabled={loading || monitoring || generating}
            className="w-fit shrink-0 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-medium text-ink-secondary transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>

        </div>

        {/* ========================================
           GOOGLE CONNECTION
        ======================================== */}

        <div
          className={`mt-6 flex flex-col gap-3 rounded-xl border p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between ${
            googleStatus?.connected &&
            (googleStatus.discoveryIssues
              ?.length ?? 0) > 0
              ? "border-warning/30 bg-warning-bg"
              : "border-border bg-surface"
          }`}
        >

          <div>
            <div className="text-sm font-semibold">
              Google Search Console &amp; Analytics
            </div>

            {googleStatus?.connected &&
            (googleStatus.discoveryIssues
              ?.length ?? 0) > 0 ? (
              <>
                <p className="mt-1 text-sm text-warning-text">
                  Connected, but not
                  receiving real data yet:
                </p>

                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-warning-text">
                  {googleStatus.discoveryIssues!.map(
                    (issue, index) => (
                      <li key={index}>
                        {issue}
                      </li>
                    )
                  )}
                </ul>

                <p className="mt-1 text-xs text-ink-muted">
                  Monitoring checks fall
                  back to synthetic mock
                  data until this is
                  resolved. Enable the
                  APIs mentioned above in
                  Google Cloud Console,
                  then reconnect.
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-ink-muted">
                {googleStatus?.connected
                  ? `Connected${
                      googleStatus.gscSiteUrl
                        ? ` · ${googleStatus.gscSiteUrl}`
                        : ""
                    }${
                      googleStatus.ga4PropertyId
                        ? ` · GA4 property ${googleStatus.ga4PropertyId}`
                        : ""
                    }. Monitoring checks use real data.`
                  : "Not connected. Monitoring checks use synthetic mock data until you connect."}
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap gap-3">
            {googleStatus?.connected ? (
              <button
                type="button"
                onClick={disconnectGoogle}
                disabled={disconnectingGoogle}
                className="rounded-lg border border-border-strong bg-surface px-4 py-2.5 text-sm font-medium text-ink-secondary transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                {disconnectingGoogle
                  ? "Disconnecting..."
                  : "Disconnect"}
              </button>
            ) : (
              <button
                type="button"
                onClick={connectGoogle}
                disabled={!tenant || connectingGoogle}
                aria-busy={connectingGoogle}
                className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-md shadow-primary/20 transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {connectingGoogle
                  ? "Redirecting to Google..."
                  : "Connect Google Search Console & Analytics"}
              </button>
            )}
          </div>

        </div>

        {/* ========================================
           ACTIONS
        ======================================== */}

        <div className="mt-6 flex flex-col gap-3 rounded-xl border border-border bg-surface shadow-sm p-5 sm:flex-row sm:items-center sm:justify-between">

          <div className="text-sm text-ink-muted">
            Requires a Stage 1 audit report.
            {googleStatus?.connected &&
            (googleStatus.discoveryIssues
              ?.length ?? 0) === 0
              ? " Analytics/search-console/ranking data comes from your connected Google account."
              : " Analytics/search-console/ranking data is currently mocked — see the Google connection status above."}
          </div>

          <div className="flex shrink-0 flex-wrap gap-3">

            <button
              type="button"
              onClick={runMonitoring}
              disabled={!tenant || monitoring || generating}
              aria-busy={monitoring}
              className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-md shadow-primary/20 transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {monitoring
                ? "Running check..."
                : "Run Monitoring Check"}
            </button>

            <button
              type="button"
              onClick={generateReport}
              disabled={!tenant || monitoring || generating}
              aria-busy={generating}
              className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm font-medium text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {generating
                ? "Generating report..."
                : "Generate Report"}
            </button>

          </div>

        </div>

        {/* ========================================
           ERRORS
        ======================================== */}

        {error && (
          <div className="mt-6 rounded-xl border border-danger-border bg-danger-bg p-5">
            <div className="text-sm font-semibold text-danger-text">
              Monitoring connection error
            </div>

            <p className="mt-1 text-sm text-danger-text">
              {error}
            </p>
          </div>
        )}

        {/* ========================================
           LOADING SKELETON
        ======================================== */}

        {loading && (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {[1, 2, 3, 4, 5].map((item) => (
                <SkeletonStat key={item} />
              ))}
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-3">
              {[1, 2, 3].map((item) => (
                <SkeletonCard key={item} lines={3} />
              ))}
            </div>
          </>
        )}

        {/* ========================================
           EMPTY STATE
        ======================================== */}

        {!loading && !snapshot && !error && (
          <EmptyState
            className="mt-6"
            icon="chart"
            title="No monitoring data yet"
            description="Run a monitoring check above to see visibility scores, traffic trend, and ranking signals."
          />
        )}

        {/* ========================================
           SCORES
        ======================================== */}

        {!loading && snapshot && (
          <>

          <section className="animate-stagger mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">

            {[
              { label: "Visibility", value: snapshot.visibilityScore },
              { label: "Citation", value: snapshot.citationScore },
              { label: "Technical", value: snapshot.technicalScore },
              { label: "Content", value: snapshot.contentScore },
              { label: "Competitor", value: snapshot.competitorScore },
            ].map((item) => (
              <div
                key={item.label}
                className="glass-card rounded-xl p-5"
              >
                <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                  {item.label}
                </div>

                <div className="mt-2 text-2xl font-bold">
                  {item.value === null ? (
                    "—"
                  ) : (
                    <CountUpNumber
                      value={item.value}
                    />
                  )}
                  <span className="ml-1 text-xs font-medium text-ink-faint">
                    /100
                  </span>
                </div>
              </div>
            ))}

          </section>

          {/* ========================================
             INSIGHTS
          ======================================== */}

          {metrics?.insights &&
            metrics.insights.length > 0 && (
              <section className="animate-stagger mt-6 space-y-3">
                {metrics.insights.map(
                  (insight, index) => (
                    <div
                      key={index}
                      className="glass-card flex items-start gap-3 rounded-xl p-4"
                    >
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          INSIGHT_BADGE[
                            insight.type
                          ] ??
                          "bg-muted text-ink-secondary"
                        }`}
                      >
                        {insight.type.replace(
                          /_/g,
                          " "
                        )}
                      </span>

                      <p className="text-sm text-ink-secondary">
                        {insight.message}
                      </p>
                    </div>
                  )
                )}
              </section>
            )}

          {/* ========================================
             TRAFFIC + SEARCH + RANKINGS
          ======================================== */}

          <section className="animate-stagger mt-6 grid gap-6 lg:grid-cols-3">

            {/* SESSIONS */}

            <div className="rounded-xl border border-border bg-surface shadow-sm p-6">

              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold">
                  Sessions
                </h3>

                {metrics?.sessions?.isSynthetic && (
                  <SyntheticBadge />
                )}
              </div>

              {metrics?.sessions ? (
                <>
                  <div className="mt-4 text-3xl font-bold">
                    {metrics.sessions.totalSessions}
                  </div>

                  <p className="mt-1 text-xs text-ink-faint">
                    {metrics.sessions.organicSessions}{" "}
                    organic ·{" "}
                    {metrics.sessions.periodStart} to{" "}
                    {metrics.sessions.periodEnd}
                  </p>

                  <Sparkline
                    points={metrics.sessions.trend}
                    valueKey="sessions"
                  />
                </>
              ) : (
                <p className="mt-4 text-sm text-ink-muted">
                  No session data yet.
                </p>
              )}

            </div>

            {/* SEARCH CONSOLE */}

            <div className="rounded-xl border border-border bg-surface shadow-sm p-6">

              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold">
                  Search Console
                </h3>

                {metrics?.searchConsole?.isSynthetic && (
                  <SyntheticBadge />
                )}
              </div>

              {metrics?.searchConsole ? (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-ink-faint">
                        Clicks
                      </div>
                      <div className="text-lg font-bold">
                        {metrics.searchConsole.totalClicks}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-ink-faint">
                        Impressions
                      </div>
                      <div className="text-lg font-bold">
                        {metrics.searchConsole.totalImpressions}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-ink-faint">
                        Avg CTR
                      </div>
                      <div className="text-lg font-bold">
                        {metrics.searchConsole.averageCtr}%
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-ink-faint">
                        Avg position
                      </div>
                      <div className="text-lg font-bold">
                        {metrics.searchConsole.averagePosition}
                      </div>
                    </div>
                  </div>

                  <Sparkline
                    points={metrics.searchConsole.trend}
                    valueKey="clicks"
                  />
                </>
              ) : (
                <p className="mt-4 text-sm text-ink-muted">
                  No search console data yet.
                </p>
              )}

            </div>

            {/* RANKINGS */}

            <div className="rounded-xl border border-border bg-surface shadow-sm p-6">

              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold">
                  Keyword rankings
                </h3>

                {metrics?.rankings?.isSynthetic && (
                  <SyntheticBadge />
                )}
              </div>

              {metrics?.rankings &&
              metrics.rankings.keywords.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {metrics.rankings.keywords.map(
                    (item) => {
                      const improved =
                        item.previousPosition !==
                          null &&
                        item.position <
                          item.previousPosition;

                      const worsened =
                        item.previousPosition !==
                          null &&
                        item.position >
                          item.previousPosition;

                      return (
                        <div
                          key={item.keyword}
                          className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2"
                        >
                          <span
                            className="min-w-0 truncate text-sm font-medium"
                            title={item.keyword}
                          >
                            {item.keyword}
                          </span>

                          <span
                            className={`shrink-0 text-xs font-semibold ${
                              improved
                                ? "text-success-text"
                                : worsened
                                ? "text-danger-text"
                                : "text-ink-muted"
                            }`}
                          >
                            #{item.position}
                            {item.previousPosition !==
                              null &&
                              ` (was #${item.previousPosition})`}
                          </span>
                        </div>
                      );
                    }
                  )}
                </div>
              ) : (
                <p className="mt-4 text-sm text-ink-muted">
                  No ranking data yet.
                </p>
              )}

            </div>

          </section>

          </>
        )}

        {/* ========================================
           LATEST REPORT
        ======================================== */}

        {!loading && (
          <section className="mt-6 rounded-xl border border-border bg-surface shadow-sm">

            <div className="flex items-center justify-between border-b border-border px-6 py-5">
              <div>
                <h2 className="text-base font-semibold">
                  Latest report
                </h2>

                <p className="mt-1 text-sm text-ink-muted">
                  Period summary with recommendations
                  for the next cycle.
                </p>
              </div>

              {report && (
                <button
                  type="button"
                  onClick={() =>
                    setViewingReport(true)
                  }
                  className="w-fit shrink-0 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20"
                >
                  View report
                </button>
              )}
            </div>

            {report ? (
              <div className="p-6">
                <div className="text-xs text-ink-faint">
                  {report.periodStart} to{" "}
                  {report.periodEnd} · Generated{" "}
                  {formatDate(report.createdAt)}
                </div>

                <p className="mt-3 text-sm leading-6 text-ink-secondary">
                  {report.summary}
                </p>
              </div>
            ) : (
              <div className="p-6">
                <EmptyState
                  icon="document"
                  title="No report yet"
                  description="Run a monitoring check, then generate a report to see it here."
                />
              </div>
            )}

          </section>
        )}

      </div>

      {/* ========================================
         REPORT MODAL
      ======================================== */}

      {viewingReport && report && (
        <Modal
          title="Latest report"
          subtitle={`${report.periodStart} to ${report.periodEnd} · Generated ${formatDate(
            report.createdAt
          )}`}
          onClose={() =>
            setViewingReport(false)
          }
          wide
        >

          <p className="text-sm leading-6 text-ink-secondary">
            {report.summary}
          </p>

          <div className="mt-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
              Audit deltas
            </div>

            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["Overall", report.auditDeltas.overallScore],
                  ["Technical SEO", report.auditDeltas.technicalSeoScore],
                  ["Content quality", report.auditDeltas.contentQualityScore],
                  ["AIO readiness", report.auditDeltas.aioReadinessScore],
                  ["GEO/citation", report.auditDeltas.geoCitationScore],
                  ["Competitor gap", report.auditDeltas.competitorGapScore],
                ] as [string, ScoreDelta][]
              ).map(([label, delta]) => (
                <div
                  key={label}
                  className="rounded-lg border border-border bg-muted px-3 py-2"
                >
                  <div className="text-xs font-semibold text-ink-secondary">
                    {label}
                  </div>
                  <div className="mt-1 text-xs text-ink-muted">
                    {formatDelta(delta)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
              Plan progress
            </div>

            <div className="mt-2 rounded-lg border border-border bg-muted px-3 py-3 text-sm text-ink-secondary">
              {report.planProgress.hasPlan ? (
                <>
                  Content plan is{" "}
                  <strong>
                    {report.planProgress.approvalStatus}
                  </strong>
                  , with{" "}
                  {report.planProgress.totalTasks}{" "}
                  execution task(s)
                  {report.planProgress.tasksByStatus
                    .published
                    ? ` (${report.planProgress.tasksByStatus.published} published)`
                    : ""}
                  .
                </>
              ) : (
                "No content plan generated yet."
              )}
            </div>
          </div>

          <div className="mt-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
              Recommendations
            </div>

            <ul className="mt-2 space-y-2">
              {report.recommendations.map(
                (recommendation, index) => (
                  <li
                    key={index}
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink-secondary"
                  >
                    {recommendation}
                  </li>
                )
              )}
            </ul>
          </div>

        </Modal>
      )}

    </main>
  );
}
