"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { authFetch } from "../../lib/auth";
import {
  loadActiveTenant,
  type TenantSummary,
} from "../../lib/tenant";

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
  const [tenant, setTenant] =
    useState<Tenant | null>(null);

  const [billing, setBilling] =
    useState<BillingStatus | null>(
      null
    );

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

      </div>

    </main>
  );
}
