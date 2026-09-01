"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { authFetch } from "@/lib/auth";
import {
  loadActiveTenant,
  type TenantSummary,
} from "@/lib/tenant";
import CountUpNumber from "@/components/CountUpNumber";
import EmptyState from "@/components/EmptyState";
import { SkeletonLine } from "@/components/Skeleton";

type Tenant = TenantSummary;

type Metrics = {
  totalQueries: number;
  mentionedQueries: number;
  mentionRate: number;
  positionedQueries: number;
  averagePosition: number | null;
  citationCount: number;
  visibilityScore: number;
};

type MetricsResponse = {
  success: boolean;
  data?: Metrics;
  error?: string;
};

type AuditCategory = {
  score: number;
  status: "good" | "warning" | "critical";
  summary: string;
};

type AuditReport = {
  overallScore: number;
  summary: string;
  priorities: string[];
  categories: {
    technicalSEO: AuditCategory;
    contentQuality: AuditCategory;
    aioReadiness: AuditCategory;
    geoCitationStatus: AuditCategory;
    competitorGap: AuditCategory | null;
  };
};

type TechnicalAuditFinding = {
  category: string;
  severity:
    | "critical"
    | "high"
    | "medium"
    | "low"
    | "info";
  title: string;
  description: string;
  recommendation: string;
};

type Stage1AuditResult = {
  websiteUrl: string;
  brandName: string;
  auditReport: AuditReport;
  completedAt: string;

  /*
   * The worker already sends the raw
   * per-agent results alongside the rolled-
   * up auditReport - only the technical
   * audit's findings are modeled here since
   * that's the only one currently rendered.
   */
  technicalAudit?: {
    findings?: TechnicalAuditFinding[];
  } | null;
};

type Stage1AuditResponse = {
  success: boolean;
  data?: Stage1AuditResult;
  error?: string;
};

const WORKER_API =
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4000";

export default function AgentsPage() {
  const [tenant, setTenant] =
    useState<Tenant | null>(null);

  const [metrics, setMetrics] =
    useState<Metrics | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [running, setRunning] =
    useState(false);

  const [query, setQuery] =
    useState("");

  const [category, setCategory] =
    useState("brand");

  const [competitors, setCompetitors] =
    useState("");

  const [result, setResult] =
    useState<Stage1AuditResult | null>(null);

  const [error, setError] =
    useState("");

  /* ========================================
     LOAD TENANT + METRICS
  ======================================== */

  async function loadAgentData() {
    try {
      setLoading(true);
      setError("");

      /* ========================================
         LOAD TENANT
      ======================================== */

      const { tenant: currentTenant } =
        await loadActiveTenant(
          WORKER_API
        );

      if (!currentTenant) {
        throw new Error(
          "No workspace found. Create one to get started."
        );
      }

      setTenant(currentTenant);

      /* ========================================
         LOAD METRICS
      ======================================== */

      const metricsResponse =
        await authFetch(
          `${WORKER_API}/api/citation-audit/metrics?tenantId=${currentTenant.id}`,
          {
            cache: "no-store",
          }
        );

      if (!metricsResponse.ok) {
        throw new Error(
          `Metrics API returned ${metricsResponse.status}`
        );
      }

      const metricsResult: MetricsResponse =
        await metricsResponse.json();

      if (
        metricsResult.success &&
        metricsResult.data
      ) {
        setMetrics(
          metricsResult.data
        );
      }
    } catch (err) {
      console.error(
        "Failed to load agent data:",
        err
      );

      setError(
        err instanceof Error
          ? err.message
          : "Unable to load agent information."
      );
    } finally {
      setLoading(false);
    }
  }

  /* ========================================
     RUN STAGE 1 AUDIT
  ======================================== */

  async function runAgent() {
    if (!tenant) {
      toast.error(
        "No workspace is available."
      );

      return;
    }

    if (!query.trim()) {
      toast.error(
        "Please enter a query before running the audit."
      );

      return;
    }

    const competitorNames = competitors
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0);

    try {
      setRunning(true);
      setResult(null);

      const response =
        await authFetch(
          `${WORKER_API}/api/tenants/${tenant.id}/stage1-audit`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              websiteUrl:
                tenant.website_url,

              queries: [
                {
                  query:
                    query.trim(),
                  category,
                },
              ],

              competitors:
                competitorNames.map(
                  (name) => ({ name })
                ),
            }),
          }
        );

      const data: Stage1AuditResponse =
        await response.json();

      if (
        !response.ok ||
        !data.success ||
        !data.data
      ) {
        throw new Error(
          data.error ||
            `Stage 1 audit API returned ${response.status}`
        );
      }

      setResult(data.data);

      toast.success(
        "Stage 1 audit completed successfully."
      );

      /* ========================================
         REFRESH METRICS
      ======================================== */

      const metricsResponse =
        await authFetch(
          `${WORKER_API}/api/citation-audit/metrics?tenantId=${tenant.id}`,
          {
            cache: "no-store",
          }
        );

      if (metricsResponse.ok) {
        const metricsResult: MetricsResponse =
          await metricsResponse.json();

        if (
          metricsResult.success &&
          metricsResult.data
        ) {
          setMetrics(
            metricsResult.data
          );
        }
      }
    } catch (err) {
      console.error(
        "Failed to run Stage 1 audit:",
        err
      );

      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to run Stage 1 audit."
      );
    } finally {
      setRunning(false);
    }
  }

  /* ========================================
     INITIAL LOAD
  ======================================== */

  useEffect(() => {
    loadAgentData();
  }, []);

  return (
    <main className="animate-page-in min-h-screen bg-page text-ink">
      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">

        {/* ========================================
           HEADER
        ======================================== */}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              Agents
            </h1>

            <p className="mt-2 text-sm text-ink-muted">
              Manage and execute the AI agents
              responsible for monitoring your brand
              visibility.
            </p>
          </div>

          <button
            onClick={loadAgentData}
            disabled={loading || running}
            className="w-fit rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-medium text-ink-secondary transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? "Loading..."
              : "Refresh"}
          </button>
        </div>

        {/* ========================================
           ERROR
        ======================================== */}

        {error && (
          <div className="mt-6 rounded-xl border border-danger-border bg-danger-bg p-5">
            <div className="text-sm font-semibold text-danger-text">
              Agent error
            </div>

            <p className="mt-1 text-sm text-danger-text">
              {error}
            </p>
          </div>
        )}

        {/* ========================================
           AGENT STATUS
        ======================================== */}

        <div className="animate-stagger mt-8 grid gap-5 lg:grid-cols-3">

          <div className="rounded-xl border border-border bg-surface shadow-sm p-6 lg:col-span-2">

            <div className="flex items-start justify-between gap-4">

              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Primary agent
                </div>

                <h2 className="mt-2 text-xl font-bold">
                  Stage 1 Audit Pipeline
                </h2>

                <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
                  Runs the technical, content/entity,
                  citation visibility, and competitor
                  benchmark agents together and produces
                  an aggregated audit report.
                </p>
              </div>

              <span
                className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
                  running
                    ? "bg-warning-bg text-warning-text"
                    : "bg-success-bg text-success-text"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    running
                      ? "animate-pulse bg-warning"
                      : "bg-success"
                  }`}
                />

                {running
                  ? "Running"
                  : "Active"}
              </span>

            </div>

            {/* AGENT CONFIGURATION */}

            <div className="animate-stagger mt-6 grid gap-3 sm:grid-cols-2">

              <div className="rounded-lg border border-border bg-muted p-4">
                <div className="text-xs text-ink-muted">
                  Provider
                </div>

                <div className="mt-1 text-sm font-semibold">
                  OpenRouter
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted p-4">
                <div className="text-xs text-ink-muted">
                  Model
                </div>

                <div className="mt-1 text-sm font-semibold">
                  GPT OSS 20B
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted p-4">
                <div className="text-xs text-ink-muted">
                  Execution
                </div>

                <div className="mt-1 text-sm font-semibold">
                  On demand
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted p-4">
                <div className="text-xs text-ink-muted">
                  Storage
                </div>

                <div className="mt-1 text-sm font-semibold">
                  PostgreSQL
                </div>
              </div>

            </div>

          </div>

          {/* ========================================
             WORKSPACE
          ======================================== */}

          <div className="rounded-xl border border-border bg-surface shadow-sm p-6">

            <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Workspace
            </div>

            {loading ? (
              <div className="mt-4 space-y-3">
                <SkeletonLine width="45%" className="h-5" />
                <SkeletonLine width="100%" />
                <SkeletonLine width="65%" />
              </div>
            ) : tenant ? (
              <>
                <h2 className="mt-3 text-lg font-bold">
                  {tenant.name}
                </h2>

                <p className="mt-1 break-all text-sm text-ink-muted">
                  {tenant.website_url}
                </p>

                <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
                  <span className="text-sm text-ink-muted">
                    Plan
                  </span>

                  <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold capitalize text-ink-secondary">
                    {tenant.plan}
                  </span>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm text-ink-muted">
                    Status
                  </span>

                  <span className="text-sm font-semibold capitalize text-success-text">
                    {tenant.status}
                  </span>
                </div>
              </>
            ) : (
              <EmptyState
                icon="link"
                title="No workspace found"
                description="Add a website to get started."
                className="mt-3 border-none bg-transparent p-0 shadow-none"
              />
            )}

          </div>

        </div>

        {/* ========================================
           RUN AGENT
        ======================================== */}

        <section className="mt-6 rounded-xl border border-border bg-surface shadow-sm">

          <div className="border-b border-border px-6 py-5">
            <h2 className="text-base font-semibold">
              Run Stage 1 audit
            </h2>

            <p className="mt-1 text-sm text-ink-muted">
              Runs the full Stage 1 pipeline (technical,
              content/entity, citation visibility, and
              competitor benchmark agents) for your
              workspace.
            </p>
          </div>

          <div className="p-6">

            <div className="grid gap-4 md:grid-cols-[1fr_180px]">

              {/* QUERY */}

              <div>
                <label
                  htmlFor="agent-query"
                  className="text-sm font-medium text-ink-secondary"
                >
                  Query
                </label>

                <input
                  id="agent-query"
                  type="text"
                  value={query}
                  onChange={(event) =>
                    setQuery(
                      event.target.value
                    )
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key ===
                        "Enter" &&
                      !running
                    ) {
                      runAgent();
                    }
                  }}
                  placeholder="e.g. What are the best software development companies?"
                  disabled={running}
                  className="mt-2 w-full rounded-lg border border-border-strong bg-surface px-4 py-3 text-sm outline-none transition placeholder:text-ink-faint focus:border-primary disabled:bg-muted"
                />
              </div>

              {/* CATEGORY */}

              <div>
                <label
                  htmlFor="agent-category"
                  className="text-sm font-medium text-ink-secondary"
                >
                  Category
                </label>

                <select
                  id="agent-category"
                  value={category}
                  onChange={(event) =>
                    setCategory(
                      event.target.value
                    )
                  }
                  disabled={running}
                  className="mt-2 w-full rounded-lg border border-border-strong bg-surface px-4 py-3 text-sm outline-none focus:border-primary disabled:bg-muted"
                >
                  <option value="brand">
                    Brand
                  </option>

                  <option value="competitive">
                    Competitive
                  </option>

                  <option value="product">
                    Product
                  </option>

                  <option value="service">
                    Service
                  </option>
                </select>
              </div>

            </div>

            {/* COMPETITORS */}

            <div className="mt-4">
              <label
                htmlFor="agent-competitors"
                className="text-sm font-medium text-ink-secondary"
              >
                Competitors (optional, comma-separated)
              </label>

              <input
                id="agent-competitors"
                type="text"
                value={competitors}
                onChange={(event) =>
                  setCompetitors(
                    event.target.value
                  )
                }
                placeholder="e.g. Acme Corp, Rival Inc (leave blank to skip competitor benchmarking)"
                disabled={running}
                className="mt-2 w-full rounded-lg border border-border-strong bg-surface px-4 py-3 text-sm outline-none transition placeholder:text-ink-faint focus:border-primary disabled:bg-muted"
              />
            </div>

            {/* RUN BUTTON */}

            <div className="mt-5 flex items-center gap-4">

              <button
                onClick={runAgent}
                disabled={
                  running ||
                  loading ||
                  !tenant ||
                  !query.trim()
                }
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {running
                  ? "Running Stage 1 audit..."
                  : "Run Stage 1 Audit"}
              </button>

              {running && (
                <div className="flex items-center gap-2 text-sm text-ink-muted">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-warning" />

                  Running technical, content, citation,
                  and competitor agents...
                </div>
              )}

            </div>

          </div>

        </section>

        {/* ========================================
           LATEST RESULT
        ======================================== */}

        {result && (
          <section className="mt-6 rounded-xl border border-border bg-surface shadow-sm">

            <div className="border-b border-border px-6 py-5">

              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">

                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Latest execution
                  </div>

                  <h2 className="mt-1 text-base font-semibold">
                    Stage 1 audit report
                  </h2>
                </div>

                <span className="w-fit rounded-full bg-muted px-3 py-1 text-xs font-semibold text-ink-secondary">
                  Overall score:{" "}
                  <CountUpNumber
                    value={
                      result.auditReport
                        .overallScore
                    }
                  />
                  /100
                </span>

              </div>

            </div>

            <div className="p-6">

              {/* SUMMARY */}

              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Summary
                </div>

                <p className="mt-2 text-sm leading-6 text-ink-secondary">
                  {result.auditReport.summary}
                </p>
              </div>

              {/* CATEGORY SCORES */}

              <div className="animate-stagger mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">

                {(
                  [
                    ["Technical SEO", result.auditReport.categories.technicalSEO],
                    ["Content quality", result.auditReport.categories.contentQuality],
                    ["AIO readiness", result.auditReport.categories.aioReadiness],
                    ["Geo/citation status", result.auditReport.categories.geoCitationStatus],
                    ["Competitor gap", result.auditReport.categories.competitorGap],
                  ] as const
                ).map(([label, category]) => (
                  <div
                    key={label}
                    className="rounded-lg border border-border bg-muted p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-ink-muted">
                        {label}
                      </div>

                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          category === null
                            ? "bg-border text-ink-faint"
                            : category.status === "good"
                            ? "bg-success-bg text-success-text"
                            : category.status === "warning"
                            ? "bg-warning-bg text-warning-text"
                            : "bg-danger-bg text-danger-text"
                        }`}
                      >
                        {category === null
                          ? "skipped"
                          : category.status}
                      </span>
                    </div>

                    <div className="mt-1 text-2xl font-bold">
                      {category === null
                        ? "—"
                        : category.score}
                    </div>

                    <p className="mt-2 text-xs leading-5 text-ink-muted">
                      {category === null
                        ? "No competitors were provided, so competitor benchmarking was skipped for this audit."
                        : category.summary}
                    </p>
                  </div>
                ))}

              </div>

              {/* PRIORITIES */}

              {result.auditReport.priorities.length > 0 && (
                <div className="mt-6">

                  <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Priorities
                  </div>

                  <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-ink-secondary">
                    {result.auditReport.priorities.map(
                      (priority, index) => (
                        <li key={index}>
                          {priority}
                        </li>
                      )
                    )}
                  </ul>

                </div>
              )}

              {/* TECHNICAL FINDINGS */}

              {result.technicalAudit
                ?.findings &&
                result.technicalAudit
                  .findings.length >
                  0 && (
                  <div className="mt-6">

                    <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      Technical findings
                    </div>

                    <div className="animate-stagger mt-3 space-y-3">
                      {result.technicalAudit.findings.map(
                        (
                          finding,
                          index
                        ) => (
                          <div
                            key={index}
                            className="rounded-lg border border-border bg-muted p-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="rounded-full bg-border px-2 py-0.5 text-[10px] font-semibold uppercase text-ink-secondary">
                                  {
                                    finding.category
                                  }
                                </span>

                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                                    finding.severity ===
                                      "critical" ||
                                    finding.severity ===
                                      "high"
                                      ? "bg-danger-bg text-danger-text"
                                      : finding.severity ===
                                        "medium"
                                      ? "bg-warning-bg text-warning-text"
                                      : "bg-info-bg text-info-text"
                                  }`}
                                >
                                  {
                                    finding.severity
                                  }
                                </span>
                              </div>
                            </div>

                            <div className="mt-2 text-sm font-semibold text-ink">
                              {
                                finding.title
                              }
                            </div>

                            <p className="mt-1 whitespace-pre-line text-xs leading-5 text-ink-muted">
                              {
                                finding.description
                              }
                            </p>

                            <p className="mt-2 text-xs leading-5 text-ink-secondary">
                              <span className="font-semibold">
                                Fix:
                              </span>{" "}
                              {
                                finding.recommendation
                              }
                            </p>
                          </div>
                        )
                      )}
                    </div>

                  </div>
                )}

            </div>

          </section>
        )}

        {/* ========================================
           PERFORMANCE
        ======================================== */}

        <section className="mt-6">

          <div className="mb-4">
            <h2 className="text-base font-semibold">
              Agent performance
            </h2>

            <p className="mt-1 text-sm text-ink-muted">
              Current results produced by the AI
              visibility agent.
            </p>
          </div>

          <div className="animate-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

            <div className="rounded-xl border border-border bg-surface shadow-sm p-5">
              <div className="text-sm text-ink-muted">
                Queries processed
              </div>

              <div className="mt-2 text-2xl font-bold">
                {loading ? (
                  <SkeletonLine width="3rem" className="h-6" />
                ) : (
                  <CountUpNumber
                    value={
                      metrics?.totalQueries ?? 0
                    }
                  />
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface shadow-sm p-5">
              <div className="text-sm text-ink-muted">
                Brand mentions
              </div>

              <div className="mt-2 text-2xl font-bold">
                {loading ? (
                  <SkeletonLine width="3rem" className="h-6" />
                ) : (
                  <CountUpNumber
                    value={
                      metrics?.mentionedQueries ?? 0
                    }
                  />
                )}
              </div>

              <div className="mt-1 text-xs text-ink-faint">
                {loading
                  ? ""
                  : `${metrics?.mentionRate ?? 0}% mention rate`}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface shadow-sm p-5">
              <div className="text-sm text-ink-muted">
                Average position
              </div>

              <div className="mt-2 text-2xl font-bold">
                {loading ? (
                  <SkeletonLine width="3rem" className="h-6" />
                ) : (
                  metrics?.averagePosition ?? "—"
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface shadow-sm p-5">
              <div className="text-sm text-ink-muted">
                Citation visibility score
              </div>

              <div className="mt-2 text-2xl font-bold">
                {loading ? (
                  <SkeletonLine width="3rem" className="h-6" />
                ) : (
                  <CountUpNumber
                    value={
                      metrics?.visibilityScore ?? 0
                    }
                  />
                )}
              </div>

              <div className="mt-1 text-xs text-ink-faint">
                Out of 100
              </div>
            </div>

          </div>

        </section>

        {/* ========================================
           CAPABILITIES
        ======================================== */}

        <section className="mt-6 rounded-xl border border-border bg-surface shadow-sm">

          <div className="border-b border-border px-6 py-5">
            <h2 className="text-base font-semibold">
              Agent capabilities
            </h2>

            <p className="mt-1 text-sm text-ink-muted">
              Operations currently supported by the
              visibility agent.
            </p>
          </div>

          <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0">

            <div className="p-6 sm:border-r sm:border-border">
              <h3 className="text-sm font-semibold">
                Query execution
              </h3>

              <p className="mt-2 text-sm leading-6 text-ink-muted">
                Sends tracked visibility questions to
                the configured AI provider and stores
                the generated response.
              </p>
            </div>

            <div className="p-6">
              <h3 className="text-sm font-semibold">
                Brand analysis
              </h3>

              <p className="mt-2 text-sm leading-6 text-ink-muted">
                Detects whether your brand appears and
                identifies ranking positions when a
                structured recommendation is present.
              </p>
            </div>

            <div className="border-t border-border p-6 sm:border-r">
              <h3 className="text-sm font-semibold">
                Competitor detection
              </h3>

              <p className="mt-2 text-sm leading-6 text-ink-muted">
                Tracks known competitive platforms
                mentioned in AI-generated responses.
              </p>
            </div>

            <div className="border-t border-border p-6">
              <h3 className="text-sm font-semibold">
                Citation extraction
              </h3>

              <p className="mt-2 text-sm leading-6 text-ink-muted">
                Extracts URLs from provider responses
                so citation visibility can be measured.
              </p>
            </div>

          </div>

        </section>

      </div>
    </main>
  );
}