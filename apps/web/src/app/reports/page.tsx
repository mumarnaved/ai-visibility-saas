"use client";

import { useEffect, useState } from "react";

import { authFetch } from "@/lib/auth";
import {
  loadActiveTenant,
  type TenantSummary,
} from "@/lib/tenant";
import Markdown from "@/components/Markdown";
import MarkdownPreview from "@/components/MarkdownPreview";
import Modal from "@/components/Modal";
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

  competitors: {
    name: string;
    count: number;
  }[];

  categories: {
    category: string;
    totalQueries: number;
    mentionedQueries: number;
    mentionRate: number;
  }[];
};

type MetricsResponse = {
  success: boolean;
  data?: Metrics;
  error?: string;
};

type QueryRecord = {
  id: string;
  query: string;
  category: string | null;
  createdAt: string;
};

type QueriesResponse = {
  success: boolean;
  data?: QueryRecord[];
  error?: string;
};

type Citation = {
  url?: string;
  title?: string;
};

type Result = {
  id: string;
  queryId: string;
  provider: string;
  model: string | null;
  response: string;
  brandMentioned: boolean;
  brandPosition: number | null;
  citations: unknown;
  competitors: unknown;
  analyzedAt: string;
  createdAt: string;
};

function getCitations(value: unknown): Citation[] {
  return Array.isArray(value)
    ? (value as Citation[])
    : [];
}

type ResultsResponse = {
  success: boolean;
  data?: Result[];
  error?: string;
};

const WORKER_API =
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4000";

export default function ReportsPage() {
  const [tenant, setTenant] =
    useState<Tenant | null>(null);

  const [metrics, setMetrics] =
    useState<Metrics | null>(null);

  const [queries, setQueries] =
    useState<QueryRecord[]>([]);

  const [results, setResults] =
    useState<Result[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [viewingResult, setViewingResult] =
    useState<Result | null>(null);

  async function loadReports() {
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
         LOAD REPORT DATA
      ======================================== */

      const [
        metricsResponse,
        queriesResponse,
        resultsResponse,
      ] = await Promise.all([
        authFetch(
          `${WORKER_API}/api/citation-audit/metrics?tenantId=${currentTenant.id}`,
          {
            cache: "no-store",
          }
        ),

        authFetch(
          `${WORKER_API}/api/citation-audit/queries?tenantId=${currentTenant.id}`,
          {
            cache: "no-store",
          }
        ),

        authFetch(
          `${WORKER_API}/api/citation-audit/latest?tenantId=${currentTenant.id}`,
          {
            cache: "no-store",
          }
        ),
      ]);

      if (!metricsResponse.ok) {
        throw new Error(
          `Metrics API returned ${metricsResponse.status}`
        );
      }

      if (!queriesResponse.ok) {
        throw new Error(
          `Queries API returned ${queriesResponse.status}`
        );
      }

      if (!resultsResponse.ok) {
        throw new Error(
          `Results API returned ${resultsResponse.status}`
        );
      }

      const metricsResult: MetricsResponse =
        await metricsResponse.json();

      const queriesResult: QueriesResponse =
        await queriesResponse.json();

      const resultsResult: ResultsResponse =
        await resultsResponse.json();

      /* ========================================
         METRICS
      ======================================== */

      if (
        !metricsResult.success ||
        !metricsResult.data
      ) {
        throw new Error(
          metricsResult.error ||
            "Unable to load visibility metrics."
        );
      }

      setMetrics(
        metricsResult.data
      );

      /* ========================================
         QUERIES
      ======================================== */

      if (
        queriesResult.success &&
        queriesResult.data
      ) {
        setQueries(
          queriesResult.data
        );
      } else {
        setQueries([]);
      }

      /* ========================================
         RESULTS
      ======================================== */

      if (
        resultsResult.success &&
        resultsResult.data
      ) {
        setResults(
          resultsResult.data
        );
      } else {
        setResults([]);
      }
    } catch (err) {
      console.error(
        "Failed to load reports:",
        err
      );

      setError(
        err instanceof Error
          ? err.message
          : "Unable to load reports."
      );
    } finally {
      setLoading(false);
    }
  }

  /* ========================================
     INITIAL LOAD
  ======================================== */

  useEffect(() => {
    loadReports();
  }, []);

  /* ========================================
     HELPERS
  ======================================== */

  function getQueryText(
    queryId: string
  ) {
    const query =
      queries.find(
        (item) =>
          item.id === queryId
      );

    return (
      query?.query ||
      "Tracked AI visibility query"
    );
  }

  function getQueryCategory(
    queryId: string
  ) {
    const query =
      queries.find(
        (item) =>
          item.id === queryId
      );

    return (
      query?.category ||
      "uncategorized"
    );
  }

  function formatDate(
    value: string
  ) {
    try {
      return new Date(
        value
      ).toLocaleString();
    } catch {
      return value;
    }
  }

  const visibilityScore =
    metrics?.visibilityScore ?? 0;

  const scoreWidth =
    Math.min(
      100,
      Math.max(
        0,
        visibilityScore
      )
    );

  return (
    <main className="animate-page-in min-h-screen bg-page text-ink">

      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">

        {/* ========================================
           HEADER
        ======================================== */}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">

          <div>

            <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {tenant?.name ||
                "Workspace"}
            </div>

            <h1 className="mt-1 text-2xl font-bold">
              Reports
            </h1>

            <p className="mt-2 text-sm text-ink-muted">
              Review AI visibility performance,
              rankings, citations, and competitive
              signals.
            </p>

          </div>

          <button
            onClick={loadReports}
            disabled={loading}
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
              Report connection error
            </div>

            <p className="mt-1 text-sm text-danger-text">
              {error}
            </p>

          </div>
        )}

        {/* ========================================
           WORKSPACE SUMMARY
        ======================================== */}

        {tenant && (
          <div className="mt-6 rounded-xl border border-border bg-surface shadow-sm p-5">

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

              <div>

                <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Workspace
                </div>

                <div className="mt-1 text-base font-bold">
                  {tenant.name}
                </div>

              </div>

              <div className="text-sm text-ink-muted">
                {tenant.website_url}
              </div>

            </div>

          </div>
        )}

        {/* ========================================
           SCORE + CORE METRICS
        ======================================== */}

        <section className="mt-6 grid gap-5 lg:grid-cols-3">

          {/* VISIBILITY SCORE */}

          <div className="rounded-xl border border-border bg-surface shadow-sm p-6">

            <div className="text-sm font-medium text-ink-muted">
              Citation Visibility Score
            </div>

            <div className="mt-4 flex items-end gap-2">

              <span className="text-5xl font-bold">
                {loading ? (
                  "-"
                ) : (
                  <CountUpNumber
                    value={visibilityScore}
                  />
                )}
              </span>

              <span className="pb-2 text-sm text-ink-faint">
                / 100
              </span>

            </div>

            <div className="mt-5 h-2 overflow-hidden rounded-full bg-border">

              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{
                  width: `${scoreWidth}%`,
                }}
              />

            </div>

            <p className="mt-4 text-sm leading-6 text-ink-muted">
              Your score combines brand mention
              frequency and ranking performance
              across tracked AI queries.
            </p>

          </div>

          {/* METRICS */}

          <div className="animate-stagger grid gap-4 sm:grid-cols-2 lg:col-span-2">

            <div className="rounded-xl border border-border bg-surface shadow-sm p-5">

              <div className="text-sm text-ink-muted">
                Total queries
              </div>

              <div className="mt-2 text-3xl font-bold">
                {loading ? (
                  "-"
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

              <div className="mt-2 text-3xl font-bold">
                {loading ? (
                  "-"
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

              <div className="mt-2 text-3xl font-bold">
                {loading
                  ? "-"
                  : metrics?.averagePosition ??
                    "-"}
              </div>

              <div className="mt-1 text-xs text-ink-faint">
                {metrics?.positionedQueries ?? 0}{" "}
                positioned queries
              </div>

            </div>

            <div className="rounded-xl border border-border bg-surface shadow-sm p-5">

              <div className="text-sm text-ink-muted">
                Citations
              </div>

              <div className="mt-2 text-3xl font-bold">
                {loading ? (
                  "-"
                ) : (
                  <CountUpNumber
                    value={
                      metrics?.citationCount ?? 0
                    }
                  />
                )}
              </div>

            </div>

          </div>

        </section>

        {/* ========================================
           CATEGORY PERFORMANCE
        ======================================== */}

        <section className="mt-6 rounded-xl border border-border bg-surface shadow-sm">

          <div className="border-b border-border px-6 py-5">

            <h2 className="text-base font-semibold">
              Category performance
            </h2>

            <p className="mt-1 text-sm text-ink-muted">
              Compare visibility across your
              tracked query categories.
            </p>

          </div>

          {loading ? (
            <div className="space-y-4 p-6">

              {[1, 2, 3].map(
                (item) => (
                  <div key={item}>

                    <SkeletonLine width="8rem" className="h-4" />

                    <SkeletonLine width="100%" className="mt-3 h-2" />

                  </div>
                )
              )}

            </div>
          ) : (
            <div className="animate-stagger divide-y divide-border">

              {metrics?.categories &&
              metrics.categories.length > 0 ? (

                metrics.categories.map(
                  (category) => (

                    <div
                      key={
                        category.category
                      }
                      className="px-6 py-5"
                    >

                      <div className="flex items-center justify-between gap-4">

                        <div>

                          <div className="text-sm font-semibold capitalize">
                            {category.category}
                          </div>

                          <div className="mt-1 text-xs text-ink-faint">
                            {
                              category.mentionedQueries
                            }{" "}
                            of{" "}
                            {
                              category.totalQueries
                            }{" "}
                            queries mentioned the
                            brand
                          </div>

                        </div>

                        <div className="text-sm font-bold">
                          {category.mentionRate}%
                        </div>

                      </div>

                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">

                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{
                            width: `${Math.min(
                              100,
                              category.mentionRate
                            )}%`,
                          }}
                        />

                      </div>

                    </div>

                  )
                )

              ) : (

                <div className="p-6">
                  <EmptyState
                    icon="chart"
                    title="No category data yet"
                    description="Run tracked queries across categories to see performance here."
                  />
                </div>

              )}

            </div>
          )}

        </section>

        {/* ========================================
           COMPETITORS
        ======================================== */}

        <section className="mt-6 rounded-xl border border-border bg-surface shadow-sm">

          <div className="border-b border-border px-6 py-5">

            <h2 className="text-base font-semibold">
              Competitor signals
            </h2>

            <p className="mt-1 text-sm text-ink-muted">
              Competitors detected in AI-generated
              responses.
            </p>

          </div>

          <div className="p-6">

            {metrics?.competitors &&
            metrics.competitors.length > 0 ? (

              <div className="animate-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">

                {metrics.competitors.map(
                  (competitor) => (

                    <div
                      key={
                        competitor.name
                      }
                      className="flex items-center justify-between rounded-lg border border-border p-4"
                    >

                      <span className="text-sm font-medium">
                        {competitor.name}
                      </span>

                      <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-ink-secondary">
                        {competitor.count}
                      </span>

                    </div>

                  )
                )}

              </div>

            ) : (

              <EmptyState
                icon="search"
                title="No competitors detected yet"
                description="Competitors mentioned in AI-generated responses will show up here."
              />

            )}

          </div>

        </section>

        {/* ========================================
           RECENT RESULTS
        ======================================== */}

        <section className="mt-6 rounded-xl border border-border bg-surface shadow-sm">

          <div className="border-b border-border px-6 py-5">

            <h2 className="text-base font-semibold">
              Recent AI results
            </h2>

            <p className="mt-1 text-sm text-ink-muted">
              Latest responses processed by the
              visibility agent.
            </p>

          </div>

          {loading ? (

            <div className="space-y-4 p-6">

              {[1, 2, 3].map(
                (item) => (

                  <div
                    key={item}
                    className="rounded-lg border border-border p-5"
                  >

                    <SkeletonLine width="75%" className="h-4" />

                    <SkeletonLine width="33%" className="mt-3 h-3" />

                  </div>

                )
              )}

            </div>

          ) : results.length === 0 ? (

            <div className="p-8">
              <EmptyState
                icon="document"
                title="No AI results yet"
                description="Run a tracked query to generate your first visibility result."
              />
            </div>

          ) : (

            <div className="animate-stagger space-y-4 p-6">

              {results
                .slice(0, 10)
                .map((result) => (

                  <article
                    key={result.id}
                    className="glass-card rounded-xl p-5"
                  >

                    {/* RESULT HEADER */}

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">

                      <div className="min-w-0">

                        <div className="flex flex-wrap items-center gap-2">

                          <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold capitalize text-ink-secondary">
                            {getQueryCategory(
                              result.queryId
                            )}
                          </span>

                          <span className="text-xs text-ink-faint">
                            {formatDate(
                              result.createdAt
                            )}
                          </span>

                        </div>

                        <p className="mt-2 text-sm font-semibold leading-6 text-ink">
                          {getQueryText(
                            result.queryId
                          )}
                        </p>

                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2">

                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            result.brandMentioned
                              ? "bg-success-bg text-success-text"
                              : "bg-danger-bg text-danger-text"
                          }`}
                        >
                          {result.brandMentioned
                            ? "Brand mentioned"
                            : "Not mentioned"}
                        </span>

                        {result.brandPosition !==
                          null && (

                          <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-ink-secondary">
                            Position #
                            {
                              result.brandPosition
                            }
                          </span>

                        )}

                        <button
                          type="button"
                          onClick={() =>
                            setViewingResult(result)
                          }
                          className="w-fit shrink-0 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20"
                        >
                          View report
                        </button>

                      </div>

                    </div>

                    {/* RESPONSE PREVIEW */}

                    <MarkdownPreview
                      content={result.response}
                      maxChars={150}
                      className="mt-4"
                    />

                    {/* METADATA */}

                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-faint">

                      <span className="max-w-full break-all">
                        Provider:{" "}
                        {result.provider}
                      </span>

                      {result.model && (
                        <span className="max-w-full break-all">
                          Model:{" "}
                          {result.model}
                        </span>
                      )}

                      <span>
                        Analyzed:{" "}
                        {formatDate(
                          result.analyzedAt
                        )}
                      </span>

                    </div>

                  </article>

                ))}

            </div>

          )}

        </section>

        {/* ========================================
           REPORT SUMMARY
        ======================================== */}

        <section className="mt-6 rounded-xl border border-border bg-surface shadow-sm">

          <div className="border-b border-border px-6 py-5">

            <h2 className="text-base font-semibold">
              Report summary
            </h2>

            <p className="mt-1 text-sm text-ink-muted">
              Current AI visibility snapshot for
              your workspace.
            </p>

          </div>

          <div className="animate-stagger grid gap-0 sm:grid-cols-2 lg:grid-cols-4">

            <div className="border-b border-border p-6 sm:border-r">

              <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Citation Visibility
              </div>

              <div className="mt-2 text-lg font-bold">
                {metrics?.visibilityScore ?? 0}
                /100
              </div>

            </div>

            <div className="border-b border-border p-6 lg:border-r">

              <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Mentions
              </div>

              <div className="mt-2 text-lg font-bold">
                {metrics?.mentionedQueries ?? 0}
              </div>

            </div>

            <div className="border-b border-border p-6 sm:border-r lg:border-b-0">

              <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Position
              </div>

              <div className="mt-2 text-lg font-bold">
                {metrics?.averagePosition ??
                  "—"}
              </div>

            </div>

            <div className="p-6">

              <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Citations
              </div>

              <div className="mt-2 text-lg font-bold">
                {metrics?.citationCount ?? 0}
              </div>

            </div>

          </div>

        </section>

      </div>

      {viewingResult && (
        <Modal
          title={getQueryText(viewingResult.queryId)}
          subtitle={`${viewingResult.provider} · ${
            viewingResult.model ?? "Unknown model"
          } · Analyzed ${formatDate(
            viewingResult.analyzedAt
          )}`}
          onClose={() => setViewingResult(null)}
          wide
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                viewingResult.brandMentioned
                  ? "bg-success-bg text-success-text"
                  : "bg-danger-bg text-danger-text"
              }`}
            >
              {viewingResult.brandMentioned
                ? "Brand mentioned"
                : "Not mentioned"}
            </span>

            {viewingResult.brandPosition !== null && (
              <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-ink-secondary">
                Position #{viewingResult.brandPosition}
              </span>
            )}
          </div>

          <div className="mt-4 rounded-xl border border-border-subtle bg-muted p-5">
            <Markdown content={viewingResult.response} />
          </div>

          {getCitations(viewingResult.citations).length >
            0 && (
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                Citations
              </div>

              <div className="mt-2 flex flex-col gap-2">
                {getCitations(
                  viewingResult.citations
                ).map((citation, index) => (
                  <div
                    key={`${citation.url}-${index}`}
                    className="rounded-lg border border-border bg-surface px-3 py-2"
                  >
                    <div className="text-xs font-semibold text-ink-secondary">
                      {citation.title ||
                        `Citation ${index + 1}`}
                    </div>

                    {citation.url && (
                      <div className="mt-1 truncate text-xs text-ink-muted">
                        {citation.url}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Modal>
      )}

    </main>
  );
}