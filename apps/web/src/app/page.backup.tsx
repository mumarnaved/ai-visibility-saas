"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Tenant = {
  id: string;
  slug: string;
  name: string;
  website_url: string;
  schema_name: string;
  status: string;
  plan: string;
  created_at: string;
};

type TenantResponse = {
  success: boolean;
  data?: Tenant;
  message?: string;
};

const navigation = [
  { name: "Overview", href: "/" },
  { name: "AI Visibility", href: "/ai-visibility" },
  { name: "Queries", href: "/queries" },
  { name: "Agents", href: "/agents" },
  { name: "Reports", href: "/reports" },
];

const stats = [
  {
    label: "AI Visibility Score",
    value: "—",
    change: "No scans yet",
  },
  {
    label: "AI Mentions",
    value: "—",
    change: "No scans yet",
  },
  {
    label: "Tracked Queries",
    value: "—",
    change: "No queries configured",
  },
  {
    label: "Active Agents",
    value: "0",
    change: "Ready to configure",
  },
];

export default function Home() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loadingTenant, setLoadingTenant] = useState(true);
  const [tenantError, setTenantError] = useState("");

  useEffect(() => {
    async function loadTenant() {
      try {
        setLoadingTenant(true);
        setTenantError("");

        const response = await fetch(
          "http://localhost:4000/api/tenants/latest",
          {
            cache: "no-store",
          }
        );

        if (!response.ok) {
          throw new Error(
            `Tenant API returned ${response.status}`
          );
        }

        const result: TenantResponse =
          await response.json();

        if (!result.success || !result.data) {
          throw new Error(
            result.message || "Unable to load tenant."
          );
        }

        setTenant(result.data);
      } catch (error) {
        console.error(
          "Failed to load tenant:",
          error
        );

        setTenantError(
          "Unable to connect to the tenant API."
        );
      } finally {
        setLoadingTenant(false);
      }
    }

    loadTenant();
  }, []);

  const tenantIsActive =
    tenant?.status?.toLowerCase() === "active";

  return (
    <main className="min-h-screen bg-[#f7f8fa] text-[#111827]">
      <div className="flex min-h-screen">

        {/* ================================
            SIDEBAR
        ================================= */}

        <aside className="hidden w-64 border-r border-[#e5e7eb] bg-white lg:flex lg:flex-col">

          {/* Logo */}

          <div className="border-b border-[#e5e7eb] px-6 py-5">
            <div className="text-lg font-bold tracking-tight">
              AI Visibility
            </div>

            <div className="mt-1 text-xs text-[#6b7280]">
              SaaS Platform
            </div>
          </div>

          {/* Navigation */}

          <nav className="flex-1 px-3 py-5">

            <div className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-[#9ca3af]">
              Workspace
            </div>

            <div className="space-y-1">

              {navigation.map((item) => (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`block w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${
                    item.href === "/"
                      ? "bg-[#111827] text-white"
                      : "text-[#4b5563] hover:bg-[#f3f4f6]"
                  }`}
                >
                  {item.name}
                </Link>
              ))}

            </div>

            <div className="mb-3 mt-8 px-3 text-xs font-semibold uppercase tracking-wider text-[#9ca3af]">
              System
            </div>

            <div className="space-y-1">

              <Link
                href="/integrations"
                className="block w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-[#4b5563] transition hover:bg-[#f3f4f6]"
              >
                Integrations
              </Link>

              <Link
                href="/settings"
                className="block w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-[#4b5563] transition hover:bg-[#f3f4f6]"
              >
                Settings
              </Link>

            </div>

          </nav>

          {/* Workspace Card */}

          <div className="border-t border-[#e5e7eb] p-4">

            <div className="rounded-lg bg-[#f9fafb] p-3">

              <div className="text-xs font-semibold text-[#6b7280]">
                WORKSPACE
              </div>

              {loadingTenant ? (
                <>
                  <div className="mt-2 h-4 w-32 animate-pulse rounded bg-[#e5e7eb]" />

                  <div className="mt-3 h-3 w-20 animate-pulse rounded bg-[#e5e7eb]" />
                </>
              ) : tenant ? (
                <>
                  <div className="mt-1 truncate text-sm font-medium">
                    {tenant.name}
                  </div>

                  <div className="mt-2 flex items-center gap-2 text-xs text-[#6b7280]">

                    <span
                      className={`h-2 w-2 rounded-full ${
                        tenantIsActive
                          ? "bg-emerald-500"
                          : "bg-amber-400"
                      }`}
                    />

                    {tenant.status}

                  </div>
                </>
              ) : (
                <>
                  <div className="mt-1 text-sm font-medium">
                    Workspace unavailable
                  </div>

                  <div className="mt-2 text-xs text-[#ef4444]">
                    {tenantError}
                  </div>
                </>
              )}

            </div>

          </div>

        </aside>

        {/* ================================
            MAIN CONTENT
        ================================= */}

        <section className="flex min-w-0 flex-1 flex-col">

          {/* Header */}

          <header className="flex h-16 items-center justify-between border-b border-[#e5e7eb] bg-white px-5 sm:px-8">

            <div>

              <h1 className="text-base font-semibold">
                Overview
              </h1>

              <p className="text-xs text-[#6b7280]">
                Monitor your brand visibility across AI systems.
              </p>

            </div>

            <Link
              href="/onboarding"
              className="rounded-lg bg-[#111827] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1f2937]"
            >
              Add website
            </Link>

          </header>

          {/* Page Content */}

          <div className="flex-1 p-5 sm:p-8">

            <div className="mx-auto max-w-7xl">

              {/* Welcome */}

              <div className="mb-8">

                <p className="text-sm font-medium text-[#6b7280]">
                  Welcome
                </p>

                <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">

                  {loadingTenant
                    ? "Loading your workspace..."
                    : tenant
                    ? `Welcome to ${tenant.name}`
                    : "Start tracking your AI visibility"}

                </h2>

                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6b7280]">

                  {tenant
                    ? "Your workspace is connected to the AI Visibility platform. You can now configure queries, agents, and monitoring."
                    : "Connect your website and begin monitoring how your brand appears across AI-powered search and assistants."}

                </p>

              </div>

              {/* Tenant Information */}

              {tenant && (
                <div className="mb-6 rounded-xl border border-[#e5e7eb] bg-white p-6">

                  <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">

                    <div>

                      <div className="text-xs font-semibold uppercase tracking-wider text-[#9ca3af]">
                        Current workspace
                      </div>

                      <div className="mt-2 text-xl font-bold">
                        {tenant.name}
                      </div>

                      <div className="mt-1 text-sm text-[#6b7280]">
                        {tenant.slug}
                      </div>

                    </div>

                    <div className="flex flex-wrap gap-3">

                      <span className="inline-flex items-center gap-2 rounded-full bg-[#f3f4f6] px-3 py-1.5 text-xs font-medium text-[#4b5563]">

                        <span
                          className={`h-2 w-2 rounded-full ${
                            tenantIsActive
                              ? "bg-emerald-500"
                              : "bg-amber-400"
                          }`}
                        />

                        {tenant.status}

                      </span>

                      <span className="rounded-full bg-[#f3f4f6] px-3 py-1.5 text-xs font-medium text-[#4b5563]">
                        {tenant.plan}
                      </span>

                    </div>

                  </div>

                  <div className="mt-5 grid gap-4 border-t border-[#e5e7eb] pt-5 sm:grid-cols-3">

                    {/* Tenant ID */}

                    <div>

                      <div className="text-xs font-medium text-[#9ca3af]">
                        Tenant ID
                      </div>

                      <div className="mt-1 break-all font-mono text-xs text-[#4b5563]">
                        {tenant.id}
                      </div>

                    </div>

                    {/* Website */}

                    <div>

                      <div className="text-xs font-medium text-[#9ca3af]">
                        Website
                      </div>

                      <a
                        href={tenant.website_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 block truncate text-sm font-medium text-[#111827] underline underline-offset-2 hover:text-[#4b5563]"
                      >
                        {tenant.website_url}
                      </a>

                    </div>

                    {/* Schema */}

                    <div>

                      <div className="text-xs font-medium text-[#9ca3af]">
                        Tenant schema
                      </div>

                      <div className="mt-1 break-all font-mono text-xs text-[#4b5563]">
                        {tenant.schema_name}
                      </div>

                    </div>

                  </div>

                </div>
              )}

              {/* Stats */}

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">

                {stats.map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-xl border border-[#e5e7eb] bg-white p-5"
                  >

                    <div className="text-sm font-medium text-[#6b7280]">
                      {stat.label}
                    </div>

                    <div className="mt-3 text-3xl font-bold tracking-tight">
                      {stat.value}
                    </div>

                    <div className="mt-2 text-xs text-[#9ca3af]">
                      {stat.change}
                    </div>

                  </div>
                ))}

              </div>

              {/* Main Cards */}

              <div className="mt-6 grid gap-6 xl:grid-cols-3">

                {/* Getting Started */}

                <div className="rounded-xl border border-[#e5e7eb] bg-white p-6 xl:col-span-2">

                  <div className="flex items-start justify-between">

                    <div>

                      <h3 className="text-base font-semibold">
                        Getting started
                      </h3>

                      <p className="mt-1 text-sm text-[#6b7280]">
                        Complete these steps to activate your workspace.
                      </p>

                    </div>

                    <span className="rounded-full bg-[#f3f4f6] px-3 py-1 text-xs font-medium text-[#6b7280]">
                      1 / 3
                    </span>

                  </div>

                  <div className="mt-6 space-y-3">

                    {/* Step 1 */}

                    <div className="flex items-center gap-4 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] p-4">

                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-semibold text-white">
                        ✓
                      </div>

                      <div className="min-w-0 flex-1">

                        <div className="text-sm font-semibold">
                          Workspace connected
                        </div>

                        <div className="mt-1 text-xs text-[#6b7280]">
                          {tenant
                            ? `${tenant.name} is connected and ${tenant.status}.`
                            : "Your workspace is being loaded."}
                        </div>

                      </div>

                      <span className="text-xs font-medium text-emerald-600">
                        Complete
                      </span>

                    </div>

                    {/* Step 2 */}

                    <div className="flex items-center gap-4 rounded-lg border border-[#e5e7eb] p-4">

                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f3f4f6] text-xs font-semibold text-[#6b7280]">
                        2
                      </div>

                      <div className="min-w-0 flex-1">

                        <div className="text-sm font-semibold">
                          Configure queries
                        </div>

                        <div className="mt-1 text-xs text-[#6b7280]">
                          Define the questions you want AI systems monitored for.
                        </div>

                      </div>

                      <Link
                        href="/queries"
                        className="rounded-md border border-[#d1d5db] px-3 py-1.5 text-xs font-medium transition hover:bg-[#f9fafb]"
                      >
                        Start
                      </Link>

                    </div>

                    {/* Step 3 */}

                    <div className="flex items-center gap-4 rounded-lg border border-[#e5e7eb] p-4">

                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f3f4f6] text-xs font-semibold text-[#6b7280]">
                        3
                      </div>

                      <div className="min-w-0 flex-1">

                        <div className="text-sm font-semibold">
                          Run your first scan
                        </div>

                        <div className="mt-1 text-xs text-[#6b7280]">
                          Start collecting your AI visibility data.
                        </div>

                      </div>

                      <Link
                        href="/ai-visibility"
                        className="rounded-md border border-[#d1d5db] px-3 py-1.5 text-xs font-medium transition hover:bg-[#f9fafb]"
                      >
                        View
                      </Link>

                    </div>

                  </div>

                </div>

                {/* System Status */}

                <div className="rounded-xl border border-[#e5e7eb] bg-white p-6">

                  <h3 className="text-base font-semibold">
                    System status
                  </h3>

                  <p className="mt-1 text-sm text-[#6b7280]">
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
                      status="Not configured"
                    />

                  </div>

                </div>

              </div>

              {/* Workspace State */}

              <div className="mt-6 rounded-xl border border-[#e5e7eb] bg-white p-6">

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

                  <div>

                    <h3 className="text-base font-semibold">
                      Workspace status
                    </h3>

                    <p className="mt-1 text-sm text-[#6b7280]">
                      Your tenant environment is connected to the platform.
                    </p>

                  </div>

                  <div className="flex items-center gap-2">

                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        tenantIsActive
                          ? "bg-emerald-500"
                          : "bg-amber-400"
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
                  <div className="mt-5 grid gap-4 sm:grid-cols-3">

                    <InfoItem
                      label="Company"
                      value={tenant.name}
                    />

                    <InfoItem
                      label="Website"
                      value={tenant.website_url}
                    />

                    <InfoItem
                      label="Plan"
                      value={tenant.plan}
                    />

                  </div>
                )}

              </div>

              {/* Error State */}

              {tenantError && (
                <div className="mt-6 rounded-xl border border-[#fecaca] bg-[#fef2f2] p-5">

                  <div className="text-sm font-semibold text-[#991b1b]">
                    Tenant connection error
                  </div>

                  <p className="mt-1 text-sm text-[#b91c1c]">
                    {tenantError}
                  </p>

                  <p className="mt-2 text-xs text-[#7f1d1d]">
                    Make sure the Worker API is running on port 4000.
                  </p>

                </div>
              )}

            </div>

          </div>

        </section>

      </div>
    </main>
  );
}

/* ========================================
   SYSTEM STATUS COMPONENT
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
    status === "Ready";

  return (
    <div className="flex items-center justify-between gap-3">

      <span className="text-sm text-[#4b5563]">
        {name}
      </span>

      <span className="flex items-center gap-2 text-xs font-medium text-[#6b7280]">

        <span
          className={`h-2 w-2 rounded-full ${
            ready
              ? "bg-emerald-500"
              : "bg-amber-400"
          }`}
        />

        {status}

      </span>

    </div>
  );
}

/* ========================================
   INFO ITEM COMPONENT
======================================== */

function InfoItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg bg-[#f9fafb] p-4">

      <div className="text-xs font-medium text-[#9ca3af]">
        {label}
      </div>

      <div className="mt-1 truncate text-sm font-semibold">
        {value}
      </div>

    </div>
  );
}