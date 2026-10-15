"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { authFetch } from "../../lib/auth";
import {
  clearSelectedTenantId,
  fetchTenantList,
  loadActiveTenant,
  setSelectedTenantId,
  type TenantSummary,
} from "../../lib/tenant";
import Modal from "../../components/Modal";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4000";

type Tenant = TenantSummary;

type PlanTier =
  | "free"
  | "growth"
  | "scale"
  | "enterprise"
  | "white_label";

interface BillingStatus {
  planTier: PlanTier;
  status: string;
  websiteLimit: number | null;
  tenantCount: number;
  currentPeriodEnd: string | null;
}

interface ProviderUsage {
  provider: "firecrawl" | "serpapi" | "openrouter";
  unit: string;
  requests: number;
  failedRequests: number;
  units: number;
  costEstimate: number;
}

interface MonthlyUsage {
  period: {
    label: string;
    start: string;
    end: string;
  };
  providers: ProviderUsage[];
  totalCostEstimate: number;
  currency: "USD";
}

const PROVIDER_LABELS: Record<
  ProviderUsage["provider"],
  { name: string; detail: string }
> = {
  openrouter: {
    name: "OpenRouter",
    detail: "AI answer checks",
  },
  firecrawl: {
    name: "Firecrawl",
    detail: "Page scraping",
  },
  serpapi: {
    name: "SerpApi",
    detail: "Search lookups",
  },
};

function formatCost(value: number): string {
  if (value === 0) {
    return "$0.00";
  }

  return value < 0.01
    ? `$${value.toFixed(4)}`
    : `$${value.toFixed(2)}`;
}

function formatUnits(
  units: number,
  unit: string
): string {
  const rounded = Math.round(units);

  return `${rounded.toLocaleString()} ${unit}${
    rounded === 1 ? "" : "s"
  }`;
}

const PLAN_LABELS: Record<
  PlanTier,
  string
> = {
  free: "Free Audit",
  growth: "Growth",
  scale: "Scale",
  enterprise: "Enterprise",
  white_label: "White-Label / Reseller",
};

const SELF_SERVE_PLANS: {
  tier: "growth" | "scale";
  name: string;
  price: string;
  description: string;
  features: string[];
}[] = [
  {
    tier: "growth",
    name: "Growth",
    price: "$29/mo",
    description:
      "Full plan with monthly execution and monitoring, one website.",
    features: [
      "AI visibility audit",
      "Content plan generation",
      "Monthly execution & monitoring",
      "1 website",
    ],
  },
  {
    tier: "scale",
    name: "Scale",
    price: "$99/mo",
    description:
      "Weekly execution and monitoring, GTM management, up to 5 websites.",
    features: [
      "Everything in Growth",
      "Weekly execution & monitoring",
      "GTM management",
      "Up to 5 websites",
    ],
  },
];

export default function SettingsPage() {
  const router = useRouter();

  const [tenant, setTenant] =
    useState<Tenant | null>(null);

  const [billing, setBilling] =
    useState<BillingStatus | null>(
      null
    );

  const [usage, setUsage] =
    useState<MonthlyUsage | null>(
      null
    );

  const [usageError, setUsageError] =
    useState("");

  const [showDelete, setShowDelete] =
    useState(false);

  const [confirmSlug, setConfirmSlug] =
    useState("");

  const [deleting, setDeleting] =
    useState(false);

  const [deleteError, setDeleteError] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [upgrading, setUpgrading] =
    useState<
      "growth" | "scale" | null
    >(null);

  async function loadData() {
    try {
      setLoading(true);
      setError("");

      const { tenant: loadedTenant } =
        await loadActiveTenant(
          API_BASE_URL
        );

      setTenant(loadedTenant);

      /*
       * Usage is informational: if it fails to
       * load, say so in its own card and carry on
       * loading billing, rather than failing the
       * whole page.
       */
      if (loadedTenant) {
        void (async () => {
          try {
            setUsageError("");

            const usageResponse =
              await authFetch(
                `${API_BASE_URL}/api/tenants/${loadedTenant.id}/usage`,
                { cache: "no-store" }
              );

            const usageJson =
              await usageResponse.json();

            if (
              !usageResponse.ok ||
              !usageJson.success
            ) {
              throw new Error(
                usageJson.error ||
                  `Usage API returned ${usageResponse.status}`
              );
            }

            setUsage(
              usageJson.data as MonthlyUsage
            );
          } catch (usageErr) {
            console.error(
              "Usage load failed:",
              usageErr
            );

            setUsageError(
              "Usage could not be loaded right now."
            );
          }
        })();
      }

      const billingResponse =
        await authFetch(
          `${API_BASE_URL}/api/billing/status`,
          { cache: "no-store" }
        );

      if (!billingResponse.ok) {
        const text =
          await billingResponse.text();

        throw new Error(
          `Billing status API returned ${billingResponse.status}: ${text}`
        );
      }

      const billingJson =
        await billingResponse.json();

      if (
        billingJson.success &&
        billingJson.data
      ) {
        setBilling(
          billingJson.data as BillingStatus
        );
      }
    } catch (err) {
      console.error(
        "Settings load failed:",
        err
      );

      setError(
        err instanceof Error
          ? err.message
          : "Failed to load settings."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();

    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(
      window.location.search
    );

    if (
      params.get("checkout") ===
      "success"
    ) {
      toast.success(
        "Your subscription is active. It may take a few seconds for your plan to update below."
      );
    } else if (
      params.get("checkout") ===
      "canceled"
    ) {
      toast(
        "Checkout was canceled. You have not been charged."
      );
    }
  }, []);

  async function startUpgrade(
    planTier: "growth" | "scale"
  ) {
    try {
      setUpgrading(planTier);

      const response = await authFetch(
        `${API_BASE_URL}/api/billing/checkout`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            planTier,
          }),
        }
      );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
            "Failed to start checkout."
        );
      }

      window.location.href =
        data.data.url;
    } catch (err) {
      console.error(
        "Checkout failed:",
        err
      );

      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to start checkout."
      );

      setUpgrading(null);
    }
  }

  /* ========================================
     DELETE WORKSPACE

     Starts the server's deprovisioning flow: the
     workspace disappears at once and its data is
     only purged after the retention period. Then
     land on another workspace, or on onboarding
     when that was the last one.
  ======================================== */

  function closeDelete() {
    if (deleting) {
      return;
    }

    setShowDelete(false);
    setConfirmSlug("");
    setDeleteError("");
  }

  async function deleteWorkspace() {
    if (
      !tenant ||
      confirmSlug.trim() !== tenant.slug
    ) {
      return;
    }

    try {
      setDeleting(true);
      setDeleteError("");

      const response = await authFetch(
        `${API_BASE_URL}/api/tenants/${tenant.id}`,
        {
          method: "DELETE",
          body: JSON.stringify({
            confirmSlug:
              confirmSlug.trim(),
          }),
        }
      );

      const json = await response
        .json()
        .catch(() => null);

      if (
        !response.ok ||
        !json?.success
      ) {
        throw new Error(
          json?.error ||
            "Failed to delete the workspace."
        );
      }

      toast.success(
        `"${tenant.name}" was deleted.`
      );

      /*
       * Pick where to land. The deleted workspace is
       * already gone from the list; if the list cannot
       * be read, fall back to the home page, which
       * redirects to onboarding when nothing is left.
       */
      clearSelectedTenantId();

      let destination = "/";

      try {
        const remaining =
          await fetchTenantList(
            API_BASE_URL
          );

        if (remaining.length === 0) {
          destination = "/onboarding";
        } else {
          setSelectedTenantId(
            remaining[0].id
          );
        }
      } catch (listError) {
        console.error(
          "Could not reload workspaces after deleting:",
          listError
        );
      }

      router.replace(destination);
    } catch (err) {
      console.error(
        "Delete workspace failed:",
        err
      );

      setDeleteError(
        err instanceof Error
          ? err.message
          : "Failed to delete the workspace."
      );

      setDeleting(false);
    }
  }

  const currentPlanTier =
    billing?.planTier ?? "free";

  return (
    <main className="animate-page-in min-h-screen bg-page text-ink">

      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">

        {/* HEADER */}

        <div>
          <h1 className="text-2xl font-bold">
            Settings
          </h1>

          <p className="mt-2 text-sm text-ink-muted">
            Manage your workspace configuration
            and billing.
          </p>
        </div>

        {/* ERROR */}

        {error && (
          <div className="mt-6 rounded-xl border border-danger-border bg-danger-bg p-4">
            <p className="text-sm text-danger-text">
              {error}
            </p>
          </div>
        )}

        {/* WORKSPACE */}

        <section className="mt-8 rounded-xl border border-border bg-surface shadow-sm">

          <div className="border-b border-border px-6 py-5">
            <h2 className="text-base font-semibold">
              Workspace
            </h2>

            <p className="mt-1 text-sm text-ink-muted">
              Basic information about your AI
              visibility workspace.
            </p>
          </div>

          <div className="p-6">

            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                Workspace name
              </div>

              <div className="mt-2 text-sm font-medium">
                {loading
                  ? "—"
                  : tenant?.name ?? "—"}
              </div>
            </div>

            <div className="mt-5">
              <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                Website URL
              </div>

              <div className="mt-2 text-sm font-medium">
                {loading
                  ? "—"
                  : tenant?.website_url ??
                    "—"}
              </div>
            </div>

          </div>

        </section>

        {/* BILLING */}

        <section className="mt-6 rounded-xl border border-border bg-surface shadow-sm">

          <div className="border-b border-border px-6 py-5">
            <h2 className="text-base font-semibold">
              Billing
            </h2>

            <p className="mt-1 text-sm text-ink-muted">
              Your current plan and upgrade
              options.
            </p>
          </div>

          <div className="p-6">

            {/* CURRENT PLAN */}

            <div className="flex w-full items-center justify-between rounded-lg border border-border bg-muted px-4 py-3">
              <div>
                <div className="text-sm font-semibold">
                  {loading
                    ? "—"
                    : PLAN_LABELS[
                        currentPlanTier
                      ]}
                </div>

                <div className="mt-1 text-xs text-ink-faint">
                  {loading || !billing
                    ? "Loading plan details"
                    : billing.websiteLimit ===
                      null
                    ? `${billing.tenantCount} website(s) used - unlimited plan`
                    : `${billing.tenantCount} of ${billing.websiteLimit} website(s) used`}
                </div>
              </div>

              <span className="rounded-full bg-success-bg px-3 py-1 text-xs font-semibold text-success-text">
                {loading || !billing
                  ? "—"
                  : billing.status}
              </span>
            </div>

            {/* SELF-SERVE PLANS */}

            <div className="animate-stagger mt-6 grid gap-4 sm:grid-cols-2">
              {SELF_SERVE_PLANS.map(
                (plan) => {
                  const isCurrent =
                    currentPlanTier ===
                    plan.tier;

                  return (
                    <div
                      key={plan.tier}
                      className="card-interactive rounded-xl border border-border p-5 transition"
                    >
                      <div className="flex items-baseline justify-between">
                        <div className="text-sm font-semibold">
                          {plan.name}
                        </div>

                        <div className="text-sm font-bold">
                          {plan.price}
                        </div>
                      </div>

                      <p className="mt-2 text-xs text-ink-muted">
                        {plan.description}
                      </p>

                      <ul className="mt-3 space-y-1">
                        {plan.features.map(
                          (feature) => (
                            <li
                              key={
                                feature
                              }
                              className="text-xs text-ink-secondary"
                            >
                              • {feature}
                            </li>
                          )
                        )}
                      </ul>

                      <button
                        type="button"
                        disabled={
                          isCurrent ||
                          upgrading !==
                            null
                        }
                        onClick={() =>
                          startUpgrade(
                            plan.tier
                          )
                        }
                        className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isCurrent
                          ? "Current plan"
                          : upgrading ===
                            plan.tier
                          ? "Redirecting..."
                          : `Upgrade to ${plan.name}`}
                      </button>
                    </div>
                  );
                }
              )}
            </div>

            {/* CONTACT US PLANS */}

            <div className="animate-stagger mt-4 grid gap-4 sm:grid-cols-2">

              <div className="card-interactive rounded-xl border border-border-strong bg-muted p-5 transition">
                <div className="text-sm font-semibold">
                  Enterprise
                </div>

                <p className="mt-2 text-xs text-ink-muted">
                  Dedicated database, custom SLA.
                </p>

                <a
                  href="mailto:sales@example.com?subject=Enterprise%20plan"
                  className="mt-4 inline-block w-full rounded-lg border border-border-strong px-4 py-2 text-center text-sm font-medium transition hover:bg-surface"
                >
                  Contact us
                </a>
              </div>

              <div className="card-interactive rounded-xl border border-border-strong bg-muted p-5 transition">
                <div className="text-sm font-semibold">
                  White-Label / Reseller
                </div>

                <p className="mt-2 text-xs text-ink-muted">
                  Resell AI visibility monitoring
                  under your own brand.
                </p>

                <a
                  href="mailto:sales@example.com?subject=White-Label%20plan"
                  className="mt-4 inline-block w-full rounded-lg border border-border-strong px-4 py-2 text-center text-sm font-medium transition hover:bg-surface"
                >
                  Contact us
                </a>
              </div>

            </div>

          </div>

        </section>

        {/* USAGE */}

        <section className="mt-6 rounded-xl border border-border bg-surface shadow-sm">

          <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
            <div>
              <h2 className="text-base font-semibold">
                Usage
              </h2>

              <p className="mt-1 text-sm text-ink-muted">
                Estimated cost of the external
                services your audits use
                {usage
                  ? ` in ${usage.period.label}`
                  : " this month"}
                .
              </p>
            </div>

            <div className="text-right">
              <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                Total (est.)
              </div>

              <div className="mt-1 text-lg font-bold">
                {usage
                  ? formatCost(
                      usage.totalCostEstimate
                    )
                  : "—"}
              </div>
            </div>
          </div>

          <div className="p-6">

            {usageError ? (
              <p className="text-sm text-danger-text">
                {usageError}
              </p>
            ) : !usage ? (
              <p className="text-sm text-ink-muted">
                Loading usage…
              </p>
            ) : (
              <div className="divide-y divide-border rounded-lg border border-border">
                {usage.providers.map(
                  (item) => {
                    const label =
                      PROVIDER_LABELS[
                        item.provider
                      ];

                    return (
                      <div
                        key={item.provider}
                        className="flex items-center justify-between gap-4 px-4 py-3"
                      >
                        <div>
                          <div className="text-sm font-semibold">
                            {label.name}
                          </div>

                          <div className="mt-1 text-xs text-ink-faint">
                            {label.detail}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-sm font-medium">
                            {formatUnits(
                              item.units,
                              item.unit
                            )}
                          </div>

                          <div className="mt-1 text-xs text-ink-faint">
                            {item.requests.toLocaleString()}{" "}
                            request
                            {item.requests === 1
                              ? ""
                              : "s"}
                            {item.failedRequests >
                            0
                              ? `, ${item.failedRequests.toLocaleString()} failed`
                              : ""}
                            {" · "}
                            {formatCost(
                              item.costEstimate
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }
                )}
              </div>
            )}

            <p className="mt-4 text-xs text-ink-faint">
              Costs are estimates from list prices,
              not an invoice. Usage resets at the
              start of each month (UTC).
            </p>

          </div>

        </section>

        {/* WORKSPACE ID */}

        <section className="mt-6 rounded-xl border border-border bg-surface shadow-sm">

          <div className="border-b border-border px-6 py-5">

            <h2 className="text-base font-semibold">
              Workspace information
            </h2>

            <p className="mt-1 text-sm text-ink-muted">
              Internal workspace information for
              troubleshooting and support.
            </p>

          </div>

          <div className="p-6">

            <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">
              Tenant ID
            </div>

            <div className="mt-2 break-all rounded-lg bg-muted px-4 py-3 font-mono text-xs text-ink-secondary">
              {loading
                ? "—"
                : tenant?.id ?? "—"}
            </div>

            <div className="mt-4 text-xs font-medium uppercase tracking-wide text-ink-faint">
              Worker API
            </div>

            <div className="mt-2 rounded-lg bg-muted px-4 py-3 font-mono text-xs text-ink-secondary">
              {API_BASE_URL}
            </div>

          </div>

        </section>

        {/* DANGER ZONE */}

        <section className="mt-6 rounded-xl border border-danger-border bg-surface shadow-sm">

          <div className="border-b border-danger-border px-6 py-5">
            <h2 className="text-base font-semibold text-danger-text">
              Danger zone
            </h2>

            <p className="mt-1 text-sm text-ink-muted">
              Irreversible actions for this
              workspace.
            </p>
          </div>

          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium">
                Delete this workspace
              </div>

              <p className="mt-1 text-xs text-ink-muted">
                It disappears immediately. Its data
                is kept for a retention period
                (30 days by default) and then
                permanently removed.
              </p>
            </div>

            <button
              type="button"
              disabled={loading || !tenant}
              onClick={() =>
                setShowDelete(true)
              }
              className="shrink-0 rounded-lg border border-danger-border bg-danger-bg px-4 py-2 text-sm font-medium text-danger-text transition hover:bg-danger hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Delete workspace
            </button>
          </div>

        </section>

      </div>

      {showDelete && tenant && (
        <Modal
          title="Delete workspace"
          subtitle="This starts permanent removal of this workspace."
          onClose={closeDelete}
        >
          <div className="space-y-4 p-6">

            <div className="rounded-lg border border-border bg-muted p-4">
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Name
                  </dt>
                  <dd className="mt-1 font-semibold">
                    {tenant.name}
                  </dd>
                </div>

                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Slug
                  </dt>
                  <dd className="mt-1 break-all font-mono text-xs">
                    {tenant.slug}
                  </dd>
                </div>

                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Tenant ID
                  </dt>
                  <dd className="mt-1 break-all font-mono text-xs">
                    {tenant.id}
                  </dd>
                </div>
              </dl>
            </div>

            <p className="text-sm text-ink-secondary">
              The workspace and its audits,
              plans and reports are hidden right
              away and permanently removed after
              the retention period. If you delete
              your last workspace you will be
              taken to onboarding to create a new
              one.
            </p>

            <div>
              <label
                htmlFor="confirm-slug"
                className="block text-sm font-medium"
              >
                Type{" "}
                <span className="font-mono">
                  {tenant.slug}
                </span>{" "}
                to confirm
              </label>

              <input
                id="confirm-slug"
                type="text"
                value={confirmSlug}
                onChange={(event) =>
                  setConfirmSlug(
                    event.target.value
                  )
                }
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                disabled={deleting}
                className="mt-2 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-danger"
              />
            </div>

            {deleteError && (
              <p className="text-sm text-danger-text">
                {deleteError}
              </p>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={closeDelete}
                disabled={deleting}
                className="rounded-lg border border-border-strong px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={deleteWorkspace}
                disabled={
                  deleting ||
                  confirmSlug.trim() !==
                    tenant.slug
                }
                className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting
                  ? "Deleting..."
                  : "Delete workspace"}
              </button>
            </div>

          </div>
        </Modal>
      )}

    </main>
  );
}
