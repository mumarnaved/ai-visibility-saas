"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { authFetch } from "../../lib/auth";
import {
  loadActiveTenant,
  type TenantSummary,
} from "../../lib/tenant";
import Markdown from "../../components/Markdown";
import MarkdownPreview from "../../components/MarkdownPreview";
import Modal from "../../components/Modal";
import CountUpNumber from "../../components/CountUpNumber";
import SharedEmptyState from "../../components/EmptyState";
import { SkeletonLine } from "../../components/Skeleton";

const API_BASE_URL = "http://localhost:4000";

type Tenant = TenantSummary;

interface Metrics {
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
}

interface Query {
  id: string;
  query: string;
  category: string;
  createdAt: string;
}

interface Citation {
  url?: string;
  title?: string;
}

interface Result {
  id: string;
  queryId: string;
  provider: string;
  model: string | null;
  response: string;
  brandMentioned: boolean;
  brandPosition: number | null;
  citations: Citation[] | null;
  competitors: string[] | null;
  analyzedAt: string;
  createdAt: string;
}

export default function AIVisibilityPage() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [queries, setQueries] = useState<Query[]>([]);
  const [results, setResults] = useState<Result[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState("");

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("brand");
  const [competitors, setCompetitors] = useState("");

  const [running, setRunning] = useState(false);

  async function loadData(showRefreshState = false) {
    try {
      if (showRefreshState) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError("");

      const { tenant: loadedTenant } =
        await loadActiveTenant(API_BASE_URL);

      if (!loadedTenant) {
        throw new Error(
          "No workspace found. Create one to get started."
        );
      }

      setTenant(loadedTenant);

      const tenantId = loadedTenant.id;

      const [
        metricsResponse,
        queriesResponse,
        resultsResponse,
      ] = await Promise.all([
        authFetch(
          `${API_BASE_URL}/api/citation-audit/metrics?tenantId=${encodeURIComponent(
            tenantId
          )}`,
          {
            cache: "no-store",
          }
        ),

        authFetch(
          `${API_BASE_URL}/api/citation-audit/queries?tenantId=${encodeURIComponent(
            tenantId
          )}`,
          {
            cache: "no-store",
          }
        ),

        authFetch(
          `${API_BASE_URL}/api/citation-audit/latest?tenantId=${encodeURIComponent(
            tenantId
          )}`,
          {
            cache: "no-store",
          }
        ),
      ]);

      if (!metricsResponse.ok) {
        const text = await metricsResponse.text();

        throw new Error(
          `Metrics API returned ${metricsResponse.status}: ${text}`
        );
      }

      if (!queriesResponse.ok) {
        const text = await queriesResponse.text();

        throw new Error(
          `Queries API returned ${queriesResponse.status}: ${text}`
        );
      }

      if (!resultsResponse.ok) {
        const text = await resultsResponse.text();

        throw new Error(
          `Results API returned ${resultsResponse.status}: ${text}`
        );
      }

      const metricsJson = await metricsResponse.json();
      const queriesJson = await queriesResponse.json();
      const resultsJson = await resultsResponse.json();

      if (metricsJson.success && metricsJson.data) {
        setMetrics(metricsJson.data as Metrics);
      }

      if (
        queriesJson.success &&
        Array.isArray(queriesJson.data)
      ) {
        setQueries(queriesJson.data as Query[]);
      }

      if (
        resultsJson.success &&
        Array.isArray(resultsJson.data)
      ) {
        setResults(resultsJson.data as Result[]);
      }
    } catch (err) {
      console.error("AI Visibility load failed:", err);

      setError(
        err instanceof Error
          ? err.message
          : "Failed to load AI Visibility data."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function runQuery() {
    if (!tenant) {
      setError("Tenant is not loaded yet.");
      return;
    }

    if (!query.trim()) {
      setError("Please enter a query.");
      return;
    }

    const competitorNames = competitors
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0);

    try {
      setRunning(true);
      setError("");

      const response = await authFetch(
        `${API_BASE_URL}/api/tenants/${tenant.id}/stage1-audit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            websiteUrl: tenant.website_url,
            queries: [
              {
                query: query.trim(),
                category,
              },
            ],
            competitors: competitorNames.map(
              (name) => ({ name })
            ),
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || `API returned ${response.status}.`
        );
      }

      if (!data.success) {
        throw new Error(
          data.error || "Stage 1 audit failed."
        );
      }

      setQuery("");

      toast.success(
        "Query completed",
        {
          description:
            "Stage 1 audit completed successfully.",
        }
      );

      await loadData(true);
    } catch (err) {
      console.error("Stage 1 audit failed:", err);

      setError(
        err instanceof Error
          ? err.message
          : "Stage 1 audit failed."
      );
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return <LoadingState />;
  }

  if (error && !tenant) {
    return (
      <main className="min-h-screen bg-page text-ink">
        <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
          <p className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
            AI Visibility
          </p>

          <h1 className="mt-1 text-3xl font-bold tracking-tight">
            AI Visibility
          </h1>

          <div className="mt-8 rounded-xl border border-danger-border bg-danger-bg p-6">
            <div className="text-sm font-semibold text-danger-text">
              Failed to load AI Visibility
            </div>

            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-danger-text">
              {error}
            </p>

            <button
              onClick={() => loadData()}
              className="mt-5 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white transition hover:bg-primary-hover"
            >
              Retry
            </button>
          </div>
        </div>
      </main>
    );
  }

  const visibilityScore = metrics?.visibilityScore ?? 0;
  const mentionRate = metrics?.mentionRate ?? 0;
  const totalQueries = metrics?.totalQueries ?? 0;
  const mentionedQueries = metrics?.mentionedQueries ?? 0;
  const positionedQueries = metrics?.positionedQueries ?? 0;
  const averagePosition = metrics?.averagePosition ?? null;
  const citationCount = metrics?.citationCount ?? 0;

  return (
    <main className="animate-page-in min-h-screen bg-page text-ink">
      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">

        {/* HEADER */}

        <header className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {tenant?.name || "Workspace"}
            </div>

            <div className="mt-2 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-sm font-bold text-white">
                AI
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Visibility Intelligence
                </p>

                <h1 className="text-3xl font-bold tracking-tight">
                  AI Visibility
                </h1>
              </div>
            </div>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-muted">
              Monitor how AI systems understand, mention,
              position, and recommend your brand.
            </p>
          </div>

          {tenant && (
            <div className="rounded-xl border border-border bg-surface px-5 py-4 shadow-sm lg:min-w-[280px]">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                Tracking
              </div>

              <div className="mt-1 text-sm font-semibold text-ink">
                {tenant.name}
              </div>

              <div className="mt-1 truncate text-xs text-ink-muted">
                {tenant.website_url}
              </div>

              <div className="mt-3 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-success" />

                <span className="text-xs font-medium text-ink-secondary">
                  {tenant.status}
                </span>

                <span className="text-xs text-border-strong">
                  •
                </span>

                <span className="text-xs text-ink-muted">
                  {tenant.plan}
                </span>
              </div>
            </div>
          )}
        </header>

        {/* ERROR */}

        {error && (
          <div className="mt-6 rounded-xl border border-danger-border bg-danger-bg p-4">
            <div className="text-sm font-semibold text-danger-text">
              Something went wrong
            </div>

            <p className="mt-1 text-sm text-danger-text">
              {error}
            </p>
          </div>
        )}

        {/* SCORE */}

        <section className="mt-8 grid gap-4 lg:grid-cols-[1.2fr_2fr]">
          <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                  Citation Visibility Score
                </div>

                <div className="mt-3 flex items-end gap-2">
                  <span className="text-5xl font-bold tracking-tight">
                    <CountUpNumber value={visibilityScore} />
                  </span>

                  <span className="mb-1 text-sm font-medium text-ink-faint">
                    /100
                  </span>
                </div>
              </div>

              <ScoreBadge score={visibilityScore} />
            </div>

            <div className="mt-6 h-3 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-700"
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(0, visibilityScore)
                  )}%`,
                }}
              />
            </div>

            <p className="mt-3 text-xs leading-5 text-ink-muted">
              Combined visibility signal based on mentions,
              positioning, and citation data.
            </p>
          </div>

          <div className="animate-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="Mention Rate"
              value={`${mentionRate}%`}
              detail={`${mentionedQueries} of ${totalQueries} queries`}
            />

            <MetricCard
              title="Queries Tracked"
              value={`${totalQueries}`}
              detail={`${queries.length} stored query records`}
            />

            <MetricCard
              title="Avg. Position"
              value={
                averagePosition !== null
                  ? `${averagePosition}`
                  : "—"
              }
              detail={`${positionedQueries} positioned queries`}
            />

            <MetricCard
              title="Citations"
              value={`${citationCount}`}
              detail="detected source citations"
            />
          </div>
        </section>

        {/* SECONDARY STATS */}

        <section className="animate-stagger mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Brand Mentions"
            value={`${mentionedQueries}`}
            detail="queries where the brand appeared"
          />

          <StatCard
            title="Positioned Queries"
            value={`${positionedQueries}`}
            detail="queries with detected position"
          />

          <StatCard
            title="Competitors"
            value={`${metrics?.competitors?.length ?? 0}`}
            detail="detected competitor brands"
          />

          <StatCard
            title="Categories"
            value={`${metrics?.categories?.length ?? 0}`}
            detail="query categories being tracked"
          />
        </section>

        {/* RUN QUERY */}

        <section className="mt-6 rounded-xl border border-border bg-surface p-6 shadow-sm">
          <div>
            <h2 className="text-base font-semibold">
              Run Stage 1 Audit
            </h2>

            <p className="mt-1 text-sm text-ink-muted">
              Runs the full Stage 1 pipeline (technical,
              content/entity, citation visibility, and
              competitor benchmark agents) for this query
              and updates the visibility data below.
            </p>
          </div>

          <div className="mt-5 flex flex-col gap-3 xl:flex-row">
            <input
              value={query}
              onChange={(event) =>
                setQuery(event.target.value)
              }
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !running
                ) {
                  runQuery();
                }
              }}
              placeholder="e.g. What is SoftwareDome?"
              className="min-w-0 flex-1 rounded-xl border border-border-strong bg-surface px-4 py-3 text-sm outline-none transition placeholder:text-ink-faint focus:border-primary focus:ring-1 focus:ring-primary"
            />

            <select
              value={category}
              onChange={(event) =>
                setCategory(event.target.value)
              }
              className="rounded-xl border border-border-strong bg-surface px-4 py-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
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
            </select>

            <button
              onClick={runQuery}
              disabled={running}
              className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? "Running..." : "Run Audit"}
            </button>
          </div>

          <div className="mt-3">
            <input
              value={competitors}
              onChange={(event) =>
                setCompetitors(event.target.value)
              }
              placeholder="Competitors (optional, comma-separated), e.g. Acme Corp, Rival Inc"
              className="w-full rounded-xl border border-border-strong bg-surface px-4 py-3 text-sm outline-none transition placeholder:text-ink-faint focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
        </section>

        {/* COMPETITORS + CATEGORIES */}

        <div className="mt-6 grid gap-6 lg:grid-cols-2">

          <section className="rounded-xl border border-border bg-surface p-6 shadow-sm">
            <div>
              <h2 className="text-base font-semibold">
                Competitors
              </h2>

              <p className="mt-1 text-sm text-ink-muted">
                Brands and platforms appearing alongside
                your company in AI responses.
              </p>
            </div>

            <div className="mt-5">
              {metrics?.competitors?.length ? (
                <div className="animate-stagger space-y-3">
                  {metrics.competitors.map(
                    (competitor) => (
                      <div
                        key={competitor.name}
                        className="flex items-center justify-between rounded-xl border border-border-subtle bg-muted px-4 py-3"
                      >
                        <span className="text-sm font-semibold">
                          {competitor.name}
                        </span>

                        <span className="rounded-full bg-surface px-3 py-1 text-xs font-semibold text-ink-secondary shadow-sm ring-1 ring-border">
                          {competitor.count}{" "}
                          {competitor.count === 1
                            ? "mention"
                            : "mentions"}
                        </span>
                      </div>
                    )
                  )}
                </div>
              ) : (
                <SharedEmptyState
                  icon="chart"
                  title="No competitor data yet"
                  description="Run an audit above to detect competitors mentioned alongside your brand."
                />
              )}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-surface p-6 shadow-sm">
            <div>
              <h2 className="text-base font-semibold">
                Query Categories
              </h2>

              <p className="mt-1 text-sm text-ink-muted">
                Visibility performance across different
                query types.
              </p>
            </div>

            <div className="mt-5">
              {metrics?.categories?.length ? (
                <div className="animate-stagger space-y-5">
                  {metrics.categories.map(
                    (item) => (
                      <div key={item.category}>
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-sm font-semibold capitalize">
                              {item.category}
                            </span>

                            <span className="ml-2 text-xs text-ink-faint">
                              {item.mentionedQueries}/
                              {item.totalQueries}
                            </span>
                          </div>

                          <span className="text-sm font-bold">
                            {item.mentionRate}%
                          </span>
                        </div>

                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-700"
                            style={{
                              width: `${Math.min(
                                100,
                                Math.max(
                                  0,
                                  item.mentionRate
                                )
                              )}%`,
                            }}
                          />
                        </div>

                        <p className="mt-2 text-xs text-ink-faint">
                          {item.mentionedQueries} of{" "}
                          {item.totalQueries} queries
                          mentioned the brand
                        </p>
                      </div>
                    )
                  )}
                </div>
              ) : (
                <SharedEmptyState
                  icon="chart"
                  title="No category data yet"
                  description="Run queries across different categories to see performance breakdowns here."
                />
              )}
            </div>
          </section>
        </div>

        {/* TRACKED QUERIES */}

        <section className="mt-6 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="flex flex-col gap-4 border-b border-border px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">
                Tracked Queries
              </h2>

              <p className="mt-1 text-sm text-ink-muted">
                Questions being monitored for your brand.
              </p>
            </div>

            <div className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-ink-secondary">
              {queries.length} queries
            </div>
          </div>

          {queries.length === 0 ? (
            <div className="px-6 py-8">
              <SharedEmptyState
                icon="search"
                title="No tracked queries"
                description="Run an AI visibility query above to start tracking questions."
              />
            </div>
          ) : (
            <div className="animate-stagger divide-y divide-border">
              {queries.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 px-6 py-5 transition hover:bg-muted sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          item.category === "competitive"
                            ? "bg-warning-bg text-warning-text"
                            : item.category === "product"
                            ? "bg-info-bg text-info-text"
                            : "bg-success-bg text-success-text"
                        }`}
                      >
                        {item.category}
                      </span>
                    </div>

                    <p className="mt-2 text-sm font-medium leading-6 text-ink">
                      {item.query}
                    </p>
                  </div>

                  <div className="shrink-0 text-xs text-ink-faint sm:text-right">
                    <div>
                      Created{" "}
                      {new Date(
                        item.createdAt
                      ).toLocaleDateString()}
                    </div>

                    <div className="mt-1">
                      ID: {item.id.slice(0, 8)}...
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* RECENT RESULTS */}

        <section className="mt-6 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="flex flex-col gap-4 border-b border-border px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">
                Recent AI Results
              </h2>

              <p className="mt-1 text-sm text-ink-muted">
                Latest responses collected from AI providers.
              </p>
            </div>

            <button
              onClick={() => loadData(true)}
              disabled={refreshing}
              className="w-fit rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-medium text-ink-secondary transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {results.length === 0 ? (
            <div className="px-6 py-8">
              <SharedEmptyState
                icon="document"
                title="No AI visibility results yet"
                description="Run a query above to generate your first AI visibility result."
              />
            </div>
          ) : (
            <div className="animate-stagger space-y-4 p-6">
              {results.map((result) => (
                <ResultCard
                  key={result.id}
                  result={result}
                  queryText={
                    queries.find(
                      (item) =>
                        item.id === result.queryId
                    )?.query ??
                    "Tracked AI visibility query"
                  }
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

/* ========================================
   RESULT CARD
======================================== */

function ResultCard({
  result,
  queryText,
}: {
  result: Result;
  queryText: string;
}) {
  const [open, setOpen] = useState(false);

  const citationCount =
    Array.isArray(result.citations)
      ? result.citations.length
      : 0;

  const competitorCount =
    Array.isArray(result.competitors)
      ? result.competitors.length
      : 0;

  return (
    <article className="glass-card rounded-xl p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                result.brandMentioned
                  ? "bg-success-bg text-success-text"
                  : "bg-danger-bg text-danger-text"
              }`}
            >
              {result.brandMentioned
                ? "Brand Mentioned"
                : "Not Mentioned"}
            </span>

            {result.brandPosition !== null && (
              <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-ink-secondary">
                Position #{result.brandPosition}
              </span>
            )}

            {citationCount > 0 && (
              <span className="rounded-full bg-info-bg px-3 py-1 text-xs font-semibold text-info-text">
                {citationCount}{" "}
                {citationCount === 1
                  ? "citation"
                  : "citations"}
              </span>
            )}

            {competitorCount > 0 && (
              <span className="rounded-full bg-warning-bg px-3 py-1 text-xs font-semibold text-warning-text">
                {competitorCount}{" "}
                {competitorCount === 1
                  ? "competitor"
                  : "competitors"}
              </span>
            )}
          </div>

          <p className="mt-2 text-sm font-semibold leading-6 text-ink">
            {queryText}
          </p>
        </div>

        <div className="flex w-full min-w-0 shrink-0 flex-col items-start gap-2 sm:w-auto sm:max-w-[200px] sm:items-end">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="w-fit shrink-0 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20"
          >
            View report
          </button>

          <div className="w-full min-w-0 text-xs text-ink-faint sm:text-right">
            <div
              className="truncate font-medium text-ink-muted"
              title={result.provider}
            >
              {result.provider}
            </div>

            <div
              className="mt-1 truncate"
              title={result.model ?? "Unknown model"}
            >
              {result.model ?? "Unknown model"}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-border-subtle bg-muted p-5">
        <MarkdownPreview
          content={result.response}
          maxChars={150}
        />
      </div>

      <div className="mt-4 flex flex-col gap-2 text-xs text-ink-faint sm:flex-row sm:items-center sm:justify-between">
        <span>
          Analyzed{" "}
          {new Date(
            result.analyzedAt
          ).toLocaleString()}
        </span>

        <span>
          Result ID: {result.id.slice(0, 8)}...
        </span>
      </div>

      {open && (
        <Modal
          title={queryText}
          subtitle={`${result.provider} · ${
            result.model ?? "Unknown model"
          } · Analyzed ${new Date(
            result.analyzedAt
          ).toLocaleString()}`}
          onClose={() => setOpen(false)}
          wide
        >
          <div className="rounded-xl border border-border-subtle bg-muted p-5">
            <Markdown content={result.response} />
          </div>

          {Array.isArray(result.citations) &&
            result.citations.length > 0 && (
              <div className="mt-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                  Citations
                </div>

                <div className="mt-2 flex flex-col gap-2">
                  {result.citations.map(
                    (citation, index) => (
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
                    )
                  )}
                </div>
              </div>
            )}
        </Modal>
      )}
    </article>
  );
}

/* ========================================
   METRIC CARD
======================================== */

function MetricCard({
  title,
  value,
  detail,
}: {
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
        {title}
      </div>

      <div className="mt-3 text-3xl font-bold tracking-tight text-ink">
        {value}
      </div>

      <div className="mt-2 text-xs leading-5 text-ink-faint">
        {detail}
      </div>
    </div>
  );
}

/* ========================================
   STAT CARD
======================================== */

function StatCard({
  title,
  value,
  detail,
}: {
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface px-5 py-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
        {title}
      </div>

      <div className="mt-2 text-2xl font-bold tracking-tight">
        {value}
      </div>

      <div className="mt-1 text-xs text-ink-faint">
        {detail}
      </div>
    </div>
  );
}

/* ========================================
   SCORE BADGE
======================================== */

function ScoreBadge({
  score,
}: {
  score: number;
}) {
  let label = "Needs Work";

  if (score >= 80) {
    label = "Excellent";
  } else if (score >= 60) {
    label = "Good";
  } else if (score >= 40) {
    label = "Fair";
  }

  return (
    <span className="rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-ink-secondary">
      {label}
    </span>
  );
}

/* ========================================
   LOADING STATE
======================================== */

function LoadingState() {
  return (
    <main className="min-h-screen bg-page text-ink">
      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <SkeletonLine width="16rem" className="h-8" />

        <SkeletonLine
          width="24rem"
          className="mt-3 h-4"
        />

        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          <div className="skeleton-shimmer h-48 rounded-xl" />

          <div className="skeleton-shimmer h-48 rounded-xl lg:col-span-2" />
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="skeleton-shimmer h-32 rounded-xl"
            />
          ))}
        </div>

        <div className="skeleton-shimmer mt-6 h-96 rounded-xl" />
      </div>
    </main>
  );
}