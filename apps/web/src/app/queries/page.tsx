"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { authFetch } from "../../lib/auth";
import {
  loadActiveTenant,
  type TenantSummary,
} from "../../lib/tenant";
import Markdown from "../../components/Markdown";
import Modal from "../../components/Modal";
import EmptyState from "../../components/EmptyState";
import { SkeletonRow } from "../../components/Skeleton";

type Tenant = TenantSummary;

type QueryRecord = {
  id: string;
  query: string;
  category: string | null;
  createdAt: string;
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
  citations: Citation[] | null;
  competitors: string[] | null;
  analyzedAt: string;
  createdAt: string;
};

type TenantResponse = {
  success: boolean;
  data?: Tenant;
  error?: string;
};

type QueriesResponse = {
  success: boolean;
  data?: QueryRecord[];
  error?: string;
};

type ResultsResponse = {
  success: boolean;
  data?: Result[];
  error?: string;
};

const WORKER_API = "http://localhost:4000";

export default function QueriesPage() {
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const [queries, setQueries] = useState<QueryRecord[]>([]);

  const [results, setResults] = useState<Result[]>([]);

  const [loading, setLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState("");

  const [viewingQuery, setViewingQuery] =
    useState<QueryRecord | null>(null);

  const [newQuery, setNewQuery] = useState("");

  const [newCategory, setNewCategory] =
    useState("brand");

  const [adding, setAdding] = useState(false);

  /* ========================================
     LOAD QUERIES AND RESULTS

     Tracked queries now come from the latest
     Stage 1 citation audit run, not from
     individually addressable database rows.
     This page is read-only: queries are
     configured as part of running a Stage 1
     audit from the Agents or AI Visibility
     pages.
  ======================================== */

  async function loadQueries(
    tenantId?: string,
    showRefreshState = false
  ) {
    try {
      if (showRefreshState) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError("");

      let currentTenantId = tenantId;

      /* ========================================
         LOAD TENANT IF NEEDED
      ======================================== */

      if (!currentTenantId) {
        const { tenant: loadedTenant } =
          await loadActiveTenant(
            WORKER_API
          );

        if (!loadedTenant) {
          throw new Error(
            "No workspace found. Create one to get started."
          );
        }

        setTenant(loadedTenant);

        currentTenantId = loadedTenant.id;
      }

      if (!currentTenantId) {
        throw new Error(
          "Tenant ID is unavailable."
        );
      }

      /* ========================================
         LOAD QUERIES AND RESULTS IN PARALLEL
      ======================================== */

      const [
        queriesResponse,
        resultsResponse,
      ] = await Promise.all([
        authFetch(
          `${WORKER_API}/api/citation-audit/queries?tenantId=${currentTenantId}`,
          {
            cache: "no-store",
          }
        ),

        authFetch(
          `${WORKER_API}/api/citation-audit/latest?tenantId=${currentTenantId}`,
          {
            cache: "no-store",
          }
        ),
      ]);

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

      const queriesData: QueriesResponse =
        await queriesResponse.json();

      const resultsData: ResultsResponse =
        await resultsResponse.json();

      if (
        !queriesData.success ||
        !queriesData.data
      ) {
        throw new Error(
          queriesData.error ||
            "Unable to load queries."
        );
      }

      setQueries(queriesData.data);

      if (
        resultsData.success &&
        resultsData.data
      ) {
        setResults(resultsData.data);
      }
    } catch (err) {
      console.error(
        "Failed to load queries:",
        err
      );

      setError(
        err instanceof Error
          ? err.message
          : "Unable to load queries."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  /* ========================================
     ADD QUERY

     There's no standalone "append a query"
     endpoint - citation_audits stores one row
     per full Stage 1 run, with that run's
     queries embedded in it. Adding a query
     means running the same Stage 1 pipeline
     the Agents/AI Visibility pages already
     use, just for this one query. Competitors
     are optional (Stage 1 skips that step
     gracefully when none are given).
  ======================================== */

  async function addQuery() {
    if (!tenant) {
      toast.error(
        "No workspace is available."
      );
      return;
    }

    const trimmedQuery = newQuery.trim();

    if (!trimmedQuery) {
      toast.error(
        "Please enter a query."
      );
      return;
    }

    try {
      setAdding(true);

      const response = await authFetch(
        `${WORKER_API}/api/tenants/${tenant.id}/stage1-audit`,
        {
          method: "POST",
          body: JSON.stringify({
            websiteUrl:
              tenant.website_url,
            queries: [
              {
                query: trimmedQuery,
                category: newCategory,
              },
            ],
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.error ||
            `Stage 1 audit API returned ${response.status}`
        );
      }

      setNewQuery("");

      toast.success("Query added");

      await loadQueries(tenant.id, true);
    } catch (err) {
      console.error(
        "Failed to add query:",
        err
      );

      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to add query."
      );
    } finally {
      setAdding(false);
    }
  }

  /* ========================================
     INITIAL LOAD
  ======================================== */

  useEffect(() => {
    loadQueries();
  }, []);

  /* ========================================
     FORMAT DATE
  ======================================== */

  function formatDate(value: string) {
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  }

  /* ========================================
     GET LATEST RESULT FOR QUERY
  ======================================== */

  function getLatestResultForQuery(
    queryId: string
  ): Result | undefined {
    return results.find(
      (r) => r.queryId === queryId
    );
  }

  return (
    <main className="animate-page-in min-h-screen bg-page text-ink">
      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">

        {/* ========================================
           HEADER
        ======================================== */}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">

          <div>
            <h1 className="text-2xl font-bold">
              Queries
            </h1>

            <p className="mt-2 text-sm text-ink-muted">
              Add and review the questions tracked by
              your most recent Stage 1 audit run.
            </p>
          </div>

          <button
            onClick={() =>
              loadQueries(
                tenant?.id,
                true
              )
            }
            disabled={
              loading ||
              refreshing
            }
            className="w-fit rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-medium text-ink-secondary transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {refreshing
              ? "Refreshing..."
              : "Refresh"}
          </button>

        </div>

        {/* ========================================
           ERROR
        ======================================== */}

        {error && (
          <div className="mt-6 rounded-xl border border-danger-border bg-danger-bg p-5">

            <div className="text-sm font-semibold text-danger-text">
              Query error
            </div>

            <p className="mt-1 text-sm text-danger-text">
              {error}
            </p>

          </div>
        )}

        {/* ========================================
           WORKSPACE
        ======================================== */}

        {tenant && (
          <div className="mt-8 rounded-xl border border-border bg-surface shadow-sm p-5">

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">

              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Workspace
                </div>

                <div className="mt-1 text-base font-bold">
                  {tenant.name}
                </div>
              </div>

              <div className="break-all text-sm text-ink-muted">
                {tenant.website_url}
              </div>

            </div>

          </div>
        )}

        {/* ========================================
           ADD QUERY
        ======================================== */}

        <section className="mt-6 rounded-xl border border-border bg-surface shadow-sm">

          <div className="border-b border-border px-6 py-5">
            <h2 className="text-base font-semibold">
              Track a new query
            </h2>

            <p className="mt-1 text-sm text-ink-muted">
              Add a question to monitor. This runs a
              Stage 1 audit for your workspace using
              this query.
            </p>
          </div>

          <div className="p-6">

            <div className="grid gap-4 md:grid-cols-[1fr_180px]">

              <div>
                <label
                  htmlFor="new-query"
                  className="text-sm font-medium text-ink-secondary"
                >
                  Query
                </label>

                <input
                  id="new-query"
                  type="text"
                  value={newQuery}
                  onChange={(event) =>
                    setNewQuery(
                      event.target.value
                    )
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !adding
                    ) {
                      addQuery();
                    }
                  }}
                  placeholder="e.g. What are the best software development companies?"
                  disabled={adding}
                  className="mt-2 w-full rounded-lg border border-border-strong bg-surface px-4 py-3 text-sm outline-none transition placeholder:text-ink-faint focus:border-primary disabled:bg-muted"
                />
              </div>

              <div>
                <label
                  htmlFor="new-query-category"
                  className="text-sm font-medium text-ink-secondary"
                >
                  Category
                </label>

                <select
                  id="new-query-category"
                  value={newCategory}
                  onChange={(event) =>
                    setNewCategory(
                      event.target.value
                    )
                  }
                  disabled={adding}
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

            <div className="mt-5">
              <button
                type="button"
                onClick={addQuery}
                disabled={
                  adding ||
                  !tenant ||
                  !newQuery.trim()
                }
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {adding
                  ? "Adding query..."
                  : "Add query"}
              </button>
            </div>

          </div>

        </section>

        {/* ========================================
           QUERY LIST
        ======================================== */}

        <section className="mt-6 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">

          <div className="border-b border-border px-6 py-5">

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">

              <div>

                <h2 className="text-base font-semibold">
                  Tracked queries
                </h2>

                <p className="mt-1 text-sm text-ink-muted">
                  Queries from the latest Stage 1
                  audit run.
                </p>

              </div>

              <div className="text-sm text-ink-muted">
                {queries.length}{" "}
                {queries.length === 1
                  ? "query"
                  : "queries"}
              </div>

            </div>

          </div>

          {loading ? (
            <div className="space-y-3 p-6">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : queries.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon="search"
                title="No queries yet"
                description="Add a query above to start tracking questions for your workspace."
              />
            </div>
          ) : (
            <div className="animate-stagger divide-y divide-border">

              {queries.map(
                (queryRecord) => {

                  const latestResult =
                    getLatestResultForQuery(
                      queryRecord.id
                    );

                  const citationCount =
                    Array.isArray(
                      latestResult?.citations
                    )
                      ? latestResult.citations.length
                      : 0;

                  return (
                    <div
                      key={queryRecord.id}
                      className="px-6 py-5 transition hover:bg-muted"
                    >

                      {/* ROW 1 */}

                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">

                        {/* LEFT */}

                        <div className="min-w-0 flex-1">

                          <div className="flex flex-wrap items-center gap-2">

                            <span
                              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                queryRecord.category ===
                                "competitive"
                                  ? "bg-warning-bg text-warning-text"
                                  : queryRecord.category ===
                                    "product"
                                  ? "bg-info-bg text-info-text"
                                  : queryRecord.category ===
                                    "service"
                                  ? "bg-warning-bg text-warning-text"
                                  : "bg-success-bg text-success-text"
                              }`}
                            >
                              {queryRecord.category ||
                                "uncategorized"}
                            </span>

                            {latestResult && (
                              <span
                                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                  latestResult.brandMentioned
                                    ? "bg-success-bg text-success-text"
                                    : "bg-danger-bg text-danger-text"
                                }`}
                              >
                                {latestResult.brandMentioned
                                  ? "Mentioned"
                                  : "Not mentioned"}
                              </span>
                            )}

                          </div>

                          <p className="mt-2 text-sm font-medium leading-6 text-ink">
                            {queryRecord.query}
                          </p>

                          <div className="mt-3 text-xs text-ink-faint">
                            From audit run{" "}
                            {formatDate(
                              queryRecord.createdAt
                            )}
                          </div>

                        </div>

                        {/* VIEW RESULT */}

                        {latestResult && (
                          <button
                            type="button"
                            onClick={() =>
                              setViewingQuery(
                                queryRecord
                              )
                            }
                            className="w-fit shrink-0 rounded-lg border border-border-strong bg-surface px-3 py-2 text-xs font-semibold text-ink-secondary transition hover:bg-muted hover:text-ink"
                          >
                            View result
                          </button>
                        )}

                      </div>

                      {/* ROW 2 */}

                      {latestResult && (
                        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">

                          {/* PROVIDER */}

                          <div className="flex min-w-0 items-center gap-2 rounded-lg bg-muted px-3 py-2">

                            <div className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
                              Provider
                            </div>

                            <div
                              className="min-w-0 truncate text-sm font-semibold text-ink"
                              title={latestResult.provider}
                            >
                              {latestResult.provider}
                            </div>

                          </div>

                          {/* MODEL */}

                          <div className="flex min-w-0 items-center gap-2 rounded-lg bg-muted px-3 py-2">

                            <div className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
                              Model
                            </div>

                            <div
                              className="min-w-0 truncate text-sm font-semibold text-ink"
                              title={
                                latestResult.model ||
                                "Unknown"
                              }
                            >
                              {latestResult.model ||
                                "Unknown"}
                            </div>

                          </div>

                          {/* POSITION */}

                          <div className="flex min-w-0 items-center gap-2 rounded-lg bg-muted px-3 py-2">

                            <div className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
                              Position
                            </div>

                            <div className="min-w-0 truncate text-sm font-semibold text-ink">
                              {latestResult.brandPosition !==
                              null
                                ? `#${latestResult.brandPosition}`
                                : "—"}
                            </div>

                          </div>

                          {/* CITATIONS */}

                          <div className="flex min-w-0 items-center gap-2 rounded-lg bg-muted px-3 py-2">

                            <div className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
                              Citations
                            </div>

                            <div className="min-w-0 truncate text-sm font-semibold text-ink">
                              {citationCount}
                            </div>

                          </div>

                          {/* ANALYZED */}

                          <div className="flex min-w-0 items-center gap-2 rounded-lg bg-muted px-3 py-2 lg:col-span-2">

                            <div className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
                              Analyzed
                            </div>

                            <div
                              className="min-w-0 truncate text-sm font-semibold text-ink"
                              title={formatDate(
                                latestResult.analyzedAt
                              )}
                            >
                              {formatDate(
                                latestResult.analyzedAt
                              )}
                            </div>

                          </div>

                        </div>
                      )}

                    </div>
                  );
                }
              )}

            </div>
          )}

        </section>

      </div>

      {viewingQuery && (() => {
        const viewingResult = getLatestResultForQuery(
          viewingQuery.id
        );

        if (!viewingResult) {
          return null;
        }

        const citations = Array.isArray(
          viewingResult.citations
        )
          ? viewingResult.citations
          : [];

        return (
          <Modal
            title={viewingQuery.query}
            subtitle={`${viewingResult.provider} · ${
              viewingResult.model ?? "Unknown model"
            } · Analyzed ${formatDate(
              viewingResult.analyzedAt
            )}`}
            onClose={() => setViewingQuery(null)}
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

            {citations.length > 0 && (
              <div className="mt-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                  Citations
                </div>

                <div className="mt-2 flex flex-col gap-2">
                  {citations.map((citation, index) => (
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
        );
      })()}
    </main>
  );
}
