"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { logout } from "../lib/auth";

import type { TenantSummary } from "../lib/tenant";

import { PUBLIC_PATHS } from "./AuthGuard";

const navigation = [
  {
    name: "Overview",
    href: "/",
  },
  {
    name: "AI Visibility",
    href: "/ai-visibility",
  },
  {
    name: "Queries",
    href: "/queries",
  },
  {
    name: "Agents",
    href: "/agents",
  },
  {
    name: "Reports",
    href: "/reports",
  },
  {
    name: "Content Plan",
    href: "/content-plan",
  },
  {
    name: "Execution",
    href: "/execution",
  },
  {
    name: "Monitoring",
    href: "/monitoring",
  },
  {
    name: "Settings",
    href: "/settings",
  },
];

function NavigationContent({
  tenant,
  tenants,
  onSwitchTenant,
  pathname,
  loggingOut,
  onLogout,
  onNavigate,
}: {
  tenant: TenantSummary | null;
  tenants: TenantSummary[];
  onSwitchTenant: (
    tenantId: string
  ) => void;
  pathname: string;
  loggingOut: boolean;
  onLogout: () => void;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="border-b border-glass-border px-6 py-5">
        <Link
          href="/"
          className="block"
          onClick={onNavigate}
        >
          <div className="text-lg font-bold text-ink">
            AI Visibility
          </div>

          <div className="mt-1 text-xs text-ink-muted">
            AI search visibility platform
          </div>
        </Link>
      </div>

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-5">
        {navigation.map((item) => {
          const active =
            pathname === item.href ||
            (
              item.href !== "/" &&
              pathname.startsWith(item.href)
            );

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`block rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? "bg-gradient-to-r from-primary to-primary-hover text-white shadow-md shadow-primary/30"
                  : "text-ink-secondary hover:bg-glass-surface-nested hover:text-ink"
              }`}
            >
              {item.name}
            </Link>
          );
        })}
      </nav>

      {tenant && (
        <div className="border-t border-glass-border p-4">
          <div className="glass-nested rounded-lg p-3">
            <div className="text-xs text-ink-muted">
              Workspace
            </div>

            {tenants.length > 1 ? (
              <select
                value={tenant.id}
                onChange={(event) =>
                  onSwitchTenant(
                    event.target.value
                  )
                }
                aria-label="Switch workspace"
                className="mt-1 w-full truncate rounded-md border border-glass-border bg-glass-surface px-2 py-1.5 text-sm font-semibold text-ink outline-none transition hover:bg-glass-surface-strong focus:border-primary"
              >
                {tenants.map((item) => (
                  <option
                    key={item.id}
                    value={item.id}
                  >
                    {item.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="mt-1 truncate text-sm font-semibold text-ink">
                {tenant.name}
              </div>
            )}

            <button
              onClick={onLogout}
              disabled={loggingOut}
              className="mt-3 w-full rounded-lg border border-glass-border bg-glass-surface px-3 py-2 text-sm font-medium text-ink-secondary transition hover:bg-glass-surface-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loggingOut
                ? "Logging out..."
                : "Log out"}
            </button>
          </div>
        </div>
      )}

      <div className="border-t border-glass-border p-4">
        <Link
          href="/onboarding"
          onClick={onNavigate}
          className="block rounded-lg bg-primary px-4 py-2.5 text-center text-sm font-medium text-white shadow-md shadow-primary/30 transition hover:bg-primary-hover"
        >
          + Add website
        </Link>
      </div>
    </>
  );
}

export default function AppNavigation({
  tenant,
  tenants,
  onSwitchTenant,
}: {
  tenant: TenantSummary | null;
  tenants: TenantSummary[];
  onSwitchTenant: (
    tenantId: string
  ) => void;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const [loggingOut, setLoggingOut] =
    useState(false);

  const [
    mobileMenuOpen,
    setMobileMenuOpen,
  ] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);

    try {
      await logout();
    } finally {
      router.replace("/login");
    }
  }

  if (PUBLIC_PATHS.includes(pathname)) {
    return null;
  }

  return (
    <>
      {/* ========================================
         MOBILE TOP BAR

         The desktop sidebar below is hidden
         under lg (1024px) - without this, there
         would be no way to navigate at all on a
         narrow screen.

         Flush against the viewport edge (no
         floating margin/rounding) and using the
         same bg-surface + border-b treatment as
         every page's own header, so the two read
         as one continuous header block - a
         top utility row plus the page's own
         title row - rather than two separate
         floating cards with a gap between them.
      ======================================== */}

      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-surface px-4 shadow-sm lg:hidden">
        <Link href="/" className="text-base font-bold text-ink">
          AI Visibility
        </Link>

        <button
          type="button"
          onClick={() =>
            setMobileMenuOpen(true)
          }
          aria-label="Open navigation menu"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-secondary transition hover:bg-glass-surface-nested hover:text-ink"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </div>

      {/* ========================================
         MOBILE DRAWER
      ======================================== */}

      {mobileMenuOpen && (
        <div
          className="modal-backdrop-in fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm lg:hidden"
          onClick={() =>
            setMobileMenuOpen(false)
          }
        >
          <aside
            className="glass-panel animate-page-in fixed inset-y-2 left-2 flex w-64 max-w-[80vw] flex-col rounded-2xl"
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <NavigationContent
              tenant={tenant}
              tenants={tenants}
              onSwitchTenant={
                onSwitchTenant
              }
              pathname={pathname}
              loggingOut={loggingOut}
              onLogout={handleLogout}
              onNavigate={() =>
                setMobileMenuOpen(false)
              }
            />
          </aside>
        </div>
      )}

      {/* ========================================
         DESKTOP SIDEBAR
      ======================================== */}

      <aside className="glass-panel fixed inset-y-2 left-2 z-40 hidden w-64 flex-col rounded-2xl lg:flex">
        <NavigationContent
          tenant={tenant}
          tenants={tenants}
          onSwitchTenant={onSwitchTenant}
          pathname={pathname}
          loggingOut={loggingOut}
          onLogout={handleLogout}
        />
      </aside>
    </>
  );
}
