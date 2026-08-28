"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  authFetch,
} from "@/lib/auth";

import DomainVerificationPanel from "@/components/DomainVerificationPanel";
import CountUpNumber from "@/components/CountUpNumber";
import EmptyState from "@/components/EmptyState";
import {
  loadActiveTenant,
  type TenantSummary,
} from "@/lib/tenant";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4000";

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
  message?: string;
  error?: string;
};

export default function Home() {
  const [tenant, setTenant] =
    useState<Tenant | null>(null);

  const [metrics, setMetrics] =
    useState<Metrics | null>(null);

  const [loadingTenant, setLoadingTenant] =
    useState(true);

  const [loadingMetrics, setLoadingMetrics] =
    useState(true);

  const [tenantError, setTenantError] =
    useState("");

  const [metricsError, setMetricsError] =
    useState("");

  const [showVerification, setShowVerification] =
    useState(false);

  async function loadDashboard() {
    try {
      setLoadingTenant(true);
      setLoadingMetrics(true);

      setTenantError("");
      setMetricsError("");

      /* ========================================
         LOAD TENANT
      ======================================== */

      const { tenant: loadedTenant } =
        await loadActiveTenant(
          API_BASE_URL
        );

      if (!loadedTenant) {
        throw new Error(
          "No workspace found. Create one to get started."
        );
      }

      setTenant(loadedTenant);
      setLoadingTenant(false);

      /* ========================================
         LOAD AI VISIBILITY METRICS
      ======================================== */

      const metricsResponse =
        await authFetch(
          `${API_BASE_URL}/api/citation-audit/metrics?tenantId=${encodeURIComponent(
            loadedTenant.id
          )}`,
          {
            method: "GET",
            cache: "no-store",
          }
        );

      if (!metricsResponse.ok) {
        let message =
          `Metrics API returned ${metricsResponse.status}`;

        try {
          const errorResult =
            await metricsResponse.json();

          message =
            errorResult?.message ??
            errorResult?.error ??
            message;
        } catch {
          // Ignore JSON parsing errors.
        }

        throw new Error(message);
      }

      const metricsResult:
        MetricsResponse =
        await metricsResponse.json();

      if (
        !metricsResult.success ||
        !metricsResult.data
      ) {
        throw new Error(
          metricsResult.message ??
            metricsResult.error ??
            "Unable to load AI visibility metrics."
        );
      }

      setMetrics(
        metricsResult.data
      );
    } catch (error) {
      console.error(
        "Dashboard loading failed:",
        error
      );

      const message =
        error instanceof Error
          ? error.message
          : "Unable to load dashboard.";

      if (!tenant) {
        setTenantError(message);
      }

      setMetricsError(message);
    } finally {
      setLoadingTenant(false);
      setLoadingMetrics(false);
    }
  }

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tenantIsActive =
    tenant?.status?.toLowerCase() ===
    "active";

  const visibilityScore =
    metrics?.visibilityScore ?? null;

  const mentionRate =
    metrics?.mentionRate ?? null;

  const totalQueries =
    metrics?.totalQueries ?? null;

  const mentionedQueries =
    metrics?.mentionedQueries ?? null;

  return (
    <main className="animate-page-in min-h-screen bg-page text-ink">

      {/* ========================================
          HEADER
      ======================================== */}

      <header className="flex h-16 items-center justify-between border-b border-border bg-surface px-5 sm:px-8">

        <div>
          <h1 className="text-base font-semibold">
            Overview
          </h1>

          <p className="text-xs text-ink-muted">
            Monitor your brand visibility across AI systems.
          </p>
        </div>

        <div className="flex items-center gap-3">

          <button
            onClick={loadDashboard}
            disabled={
              loadingTenant ||
              loadingMetrics
            }
            className="rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-medium text-ink-secondary transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingMetrics
              ? "Refreshing..."
              : "Refresh"}
          </button>

          <Link
            href="/onboarding"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-hover"
          >
            Add website
          </Link>

        </div>

      </header>

      {/* ========================================
          PAGE CONTENT
      ======================================== */}

      <div className="flex-1 p-5 sm:p-8">

        <div className="mx-auto max-w-7xl">

          {/* ========================================
              WELCOME
          ======================================== */}

          <div className="mb-8">

            <p className="text-sm font-medium text-ink-muted">
              Welcome
            </p>

            <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">

              {loadingTenant
                ? "Loading your workspace..."
                : tenant
                ? `Welcome to ${tenant.name}`
                : "Start tracking your AI visibility"}

            </h2>

            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">

              {tenant
                ? "Your workspace is connected to the AI Visibility platform. You can now configure queries, agents, and monitoring."
                : "Connect your website and begin monitoring how your brand appears across AI-powered search and assistants."}

            </p>

          </div>

          {/* ========================================
              METRICS ERROR
          ======================================== */}

          {metricsError && (
            <div className="mb-6 rounded-xl border border-danger-border bg-danger-bg p-4">

              <div className="text-sm font-semibold text-danger-text">
                Metrics unavailable
              </div>

              <p className="mt-1 text-sm text-danger-text">
                {metricsError}
              </p>

            </div>
          )}

          {/* ========================================
              DOMAIN VERIFICATION BANNER
          ======================================== */}

          {tenant && !tenant.domain_verified_at && (
            <div className="mb-6">

              {!showVerification ? (
                <div className="flex flex-col gap-4 rounded-xl border border-warning/30 bg-warning-bg p-5 sm:flex-row sm:items-center sm:justify-between">

                  <div>
                    <div className="text-sm font-semibold text-warning-text">
                      Domain not verified
                    </div>

                    <p className="mt-1 text-sm text-ink-muted">
                      Verify you own {tenant.website_url} to unlock audits.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setShowVerification(true)
                    }
                    className="shrink-0 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-ink-secondary"
                  >
                    Verify domain
                  </button>

                </div>
              ) : (
                <DomainVerificationPanel
                  tenantId={tenant.id}
                  websiteUrl={tenant.website_url}
                  verificationToken={
                    tenant.verification_token ?? ""
                  }
                  onVerified={() => {
                    setShowVerification(false);
                    loadDashboard();
                  }}
                />
              )}

            </div>
          )}

          {/* ========================================
              TENANT INFORMATION

              Automatic scan progress/failure is shown
              globally by ScanProgressBanner (rendered
              in AppShell), not here - it needs to be
              visible regardless of which page domain
              verification redirects the user to.
          ======================================== */}

          {tenant && (
            <div className="mb-6 rounded-xl border border-border bg-surface shadow-sm p-6">

              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">

                <div>

                  <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                    Current workspace
                  </div>

                  <div className="mt-2 text-xl font-bold">
                    {tenant.name}
                  </div>

                  <div className="mt-1 text-sm text-ink-muted">
                    {tenant.slug}
                  </div>

                </div>

                <div className="flex flex-wrap gap-3">

                  <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-ink-secondary">

                    <span
                      className={`h-2 w-2 rounded-full ${
                        tenantIsActive
                          ? "bg-success"
                          : "bg-warning"
                      }`}
                    />

                    {tenant.status}

                  </span>

                  <span className="rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-ink-secondary">
                    {tenant.plan}
                  </span>

                </div>

              </div>

              <div className="mt-5 grid gap-4 border-t border-border pt-5 sm:grid-cols-3">

                <div>

                  <div className="text-xs font-medium text-ink-faint">
                    Tenant ID
                  </div>

                  <div className="mt-1 break-all font-mono text-xs text-ink-secondary">
                    {tenant.id}
                  </div>

                </div>

                <div className="min-w-0">

                  <div className="text-xs font-medium text-ink-faint">
                    Website
                  </div>

                  <a
                    href={tenant.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={tenant.website_url}
                    className="mt-1 block truncate text-sm font-medium text-ink underline underline-offset-2 hover:text-ink-secondary"
                  >
                    {tenant.website_url}
                  </a>

                </div>

                <div>

                  <div className="text-xs font-medium text-ink-faint">
                    Tenant schema
                  </div>

                  <div className="mt-1 break-all font-mono text-xs text-ink-secondary">
                    {tenant.schema_name}
                  </div>

                </div>

              </div>

            </div>
          )}

          {/* ========================================
              REAL AI VISIBILITY STATS
          ======================================== */}

          <div className="animate-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">

            <StatCard
              label="Citation Visibility Score"
              value={
                loadingMetrics
                  ? "..."
                  : visibilityScore !== null
                  ? <CountUpNumber value={visibilityScore} decimals={0} />
                  : "—"
              }
              suffix={
                visibilityScore !== null
                  ? "/100"
                  : undefined
              }
              description={
                visibilityScore !== null
                  ? "Current citation visibility score"
                  : "No scans yet"
              }
            />

            <StatCard
              label="AI Mentions"
              value={
                loadingMetrics
                  ? "..."
                  : mentionedQueries !== null
                  ? <CountUpNumber value={mentionedQueries} decimals={0} />
                  : "—"
              }
              description={
                mentionRate !== null
                  ? `${mentionRate}% mention rate`
                  : "No scans yet"
              }
            />

            <StatCard
              label="Tracked Queries"
              value={
                loadingMetrics
                  ? "..."
                  : totalQueries !== null
                  ? <CountUpNumber value={totalQueries} decimals={0} />
                  : "—"
              }
              description={
                metrics
                  ? `${metrics.positionedQueries} positioned`
                  : "No queries configured"
              }
            />

            <StatCard
              label="Average Position"
              value={
                loadingMetrics
                  ? "..."
                  : metrics?.averagePosition !== null &&
                    metrics?.averagePosition !==
                      undefined
                  ? `${metrics.averagePosition}`
                  : "—"
              }
              description={
                metrics
                  ? `${metrics.citationCount} citations`
                  : "No position data yet"
              }
            />

          </div>

          {/* ========================================
              MAIN CARDS
          ======================================== */}

          <div className="animate-stagger mt-6 grid gap-6 xl:grid-cols-3">

            {/* GETTING STARTED */}

            <div className="rounded-xl border border-border bg-surface shadow-sm p-6 xl:col-span-2">

              <div className="flex items-start justify-between">

                <div>

                  <h3 className="text-base font-semibold">
                    Getting started
                  </h3>

                  <p className="mt-1 text-sm text-ink-muted">
                    Complete these steps to activate your workspace.
                  </p>

                </div>

                <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-ink-muted">
                  {tenant && metrics
                    ? "3 / 3"
                    : "1 / 3"}
                </span>

              </div>

              <div className="animate-stagger mt-6 space-y-3">

                {/* STEP 1 */}

                <div className="flex items-center gap-4 rounded-lg border border-border bg-muted p-4">

                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success text-xs font-semibold text-white">
                    ✓
                  </div>

                  <div className="min-w-0 flex-1">

                    <div className="text-sm font-semibold">
                      Workspace connected
                    </div>

                    <div className="mt-1 text-xs text-ink-muted">
                      {tenant
                        ? `${tenant.name} is connected and ${tenant.status}.`
                        : "Your workspace is being loaded."}
                    </div>

                  </div>

                  <span className="text-xs font-medium text-success-text">
                    Complete
                  </span>

                </div>

                {/* STEP 2 */}

                <div className="flex items-center gap-4 rounded-lg border border-border p-4">

                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-ink-muted">
                    2
                  </div>

                  <div className="min-w-0 flex-1">

                    <div className="text-sm font-semibold">
                      Configure queries
                    </div>

                    <div className="mt-1 text-xs text-ink-muted">
                      Define the questions you want AI systems monitored for.
                    </div>

                  </div>

                  <Link
                    href="/queries"
                    className="rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
                  >
                    Start
                  </Link>

                </div>

                {/* STEP 3 */}

                <div className="flex items-center gap-4 rounded-lg border border-border p-4">

                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-ink-muted">
                    3
                  </div>

                  <div className="min-w-0 flex-1">

                    <div className="text-sm font-semibold">
                      Run your first scan
                    </div>

                    <div className="mt-1 text-xs text-ink-muted">
                      Start collecting your AI visibility data.
                    </div>

                  </div>

                  <Link
                    href="/ai-visibility"
                    className="rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
                  >
                    View
                  </Link>

                </div>

              </div>

            </div>

            {/* SYSTEM STATUS */}

            <div className="rounded-xl border border-border bg-surface shadow-sm p-6">

              <h3 className="text-base font-semibold">
                System status
              </h3>

              <p className="mt-1 text-sm text-ink-muted">
                Platform services
              </p>

              <div className="mt-6 space-y-4">

                <StatusItem
                  name="Database"
                  status="Connected"
                />

                <StatusItem
                  name="Tenant provisioning"
                  status="Ready"
                />

                <StatusItem
                  name="Agent system"
                  status="Ready"
                />

                <StatusItem
                  name="AI providers"
                  status="OpenRouter"
                />

              </div>

            </div>

          </div>

          {/* ========================================
              AI VISIBILITY SUMMARY
          ======================================== */}

          {metrics && (
            <div className="animate-stagger mt-6 grid gap-6 lg:grid-cols-2">

              {/* PERFORMANCE */}

              <div className="rounded-xl border border-border bg-surface shadow-sm p-6">

                <h3 className="text-base font-semibold">
                  AI visibility performance
                </h3>

                <p className="mt-1 text-sm text-ink-muted">
                  Current results from tracked AI queries.
                </p>

                <div className="mt-6 space-y-5">

                  <ProgressRow
                    label="Mention rate"
                    value={
                      metrics.mentionRate
                    }
                  />

                  <ProgressRow
                    label="Citation visibility score"
                    value={
                      metrics.visibilityScore
                    }
                  />

                </div>

              </div>

              {/* COMPETITORS */}

              <div className="rounded-xl border border-border bg-surface shadow-sm p-6">

                <h3 className="text-base font-semibold">
                  Competitors detected
                </h3>

                <p className="mt-1 text-sm text-ink-muted">
                  Competitors appearing in AI responses.
                </p>

                <div className="animate-stagger mt-5 space-y-3">

                  {metrics.competitors.length ===
                  0 ? (
                    <EmptyState
                      icon="search"
                      title="No competitors detected yet"
                      description="Once AI responses mention a competitor, they'll show up here."
                    />
                  ) : (
                    metrics.competitors.map(
                      (competitor) => (
                        <div
                          key={
                            competitor.name
                          }
                          className="flex items-center justify-between rounded-lg bg-muted px-4 py-3"
                        >
                          <span className="text-sm font-medium">
                            {
                              competitor.name
                            }
                          </span>

                          <span className="text-xs font-medium text-ink-muted">
                            {
                              competitor.count
                            }{" "}
                            mentions
                          </span>
                        </div>
                      )
                    )
                  )}

                </div>

              </div>

            </div>
          )}

          {/* ========================================
              WORKSPACE STATE
          ======================================== */}

          <div className="mt-6 rounded-xl border border-border bg-surface shadow-sm p-6">

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

              <div>

                <h3 className="text-base font-semibold">
                  Workspace status
                </h3>

                <p className="mt-1 text-sm text-ink-muted">
                  Your tenant environment is connected to the platform.
                </p>

              </div>

              <div className="flex items-center gap-2">

                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    tenantIsActive
                      ? "bg-success"
                      : "bg-warning"
                  }`}
                />

                <span className="text-sm font-medium">

                  {loadingTenant
                    ? "Checking..."
                    : tenant
                    ? tenant.status
                    : "Unavailable"}

                </span>

              </div>

            </div>

            {tenant && (
              <div className="animate-stagger mt-5 grid gap-4 sm:grid-cols-3">

                <InfoItem
                  label="Company"
                  value={
                    tenant.name
                  }
                />

                <InfoItem
                  label="Website"
                  value={
                    tenant.website_url
                  }
                />

                <InfoItem
                  label="Plan"
                  value={
                    tenant.plan
                  }
                />

              </div>
            )}

          </div>

          {/* ========================================
              TENANT ERROR
          ======================================== */}

          {tenantError && (
            <div className="mt-6 rounded-xl border border-danger-border bg-danger-bg p-5">

              <div className="text-sm font-semibold text-danger-text">
                Tenant connection error
              </div>

              <p className="mt-1 text-sm text-danger-text">
                {tenantError}
              </p>

              <p className="mt-2 text-xs text-danger-text">
                Make sure the Worker API is running on port 4000.
              </p>

            </div>
          )}

        </div>

      </div>

    </main>
  );
}

/* ========================================
   STAT CARD
======================================== */

function StatCard({
  label,
  value,
  suffix,
  description,
}: {
  label: string;
  value: React.ReactNode;
  suffix?: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface shadow-sm p-5">

      <div className="text-sm font-medium text-ink-muted">
        {label}
      </div>

      <div className="mt-3 text-3xl font-bold tracking-tight">

        {value}

        {suffix && (
          <span className="ml-1 text-sm font-medium text-ink-faint">
            {suffix}
          </span>
        )}

      </div>

      <div className="mt-2 text-xs text-ink-faint">
        {description}
      </div>

    </div>
  );
}

/* ========================================
   PROGRESS ROW
======================================== */

function ProgressRow({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  const safeValue =
    Math.max(
      0,
      Math.min(100, value)
    );

  return (
    <div>

      <div className="mb-2 flex items-center justify-between">

        <span className="text-sm font-medium text-ink-secondary">
          {label}
        </span>

        <span className="text-sm font-semibold">
          {value}%
        </span>

      </div>

      <div className="h-2 overflow-hidden rounded-full bg-muted">

        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{
            width: `${safeValue}%`,
          }}
        />

      </div>

    </div>
  );
}

/* ========================================
   SYSTEM STATUS
======================================== */

function StatusItem({
  name,
  status,
}: {
  name: string;
  status: string;
}) {
  const ready =
    status === "Connected" ||
    status === "Ready" ||
    status === "OpenRouter";

  return (
    <div className="flex items-center justify-between gap-3">

      <span className="text-sm text-ink-secondary">
        {name}
      </span>

      <span className="flex items-center gap-2 text-xs font-medium text-ink-muted">

        <span
          className={`h-2 w-2 rounded-full ${
            ready
              ? "bg-success"
              : "bg-warning"
          }`}
        />

        {status}

      </span>

    </div>
  );
}

/* ========================================
   INFO ITEM
======================================== */

function InfoItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-muted p-4">

      <div className="text-xs font-medium text-ink-faint">
        {label}
      </div>

      <div
        className="mt-1 truncate text-sm font-semibold"
        title={value}
      >
        {value}
      </div>

    </div>
  );
}