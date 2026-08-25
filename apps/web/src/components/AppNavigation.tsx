"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  getCurrentTenant,
  logout,
  type AuthTenant,
} from "../lib/auth";

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
    name: "Settings",
    href: "/settings",
  },
];

export default function AppNavigation() {
  const pathname = usePathname();
  const router = useRouter();

  const [tenant, setTenant] =
    useState<AuthTenant | null>(null);

  const [loggingOut, setLoggingOut] =
    useState(false);

  useEffect(() => {
    function loadTenant() {
      setTenant(getCurrentTenant());
    }

    loadTenant();
  }, [pathname]);

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
    <aside className="glass-panel fixed inset-y-2 left-2 z-40 hidden w-64 flex-col rounded-2xl lg:flex">
      <div className="border-b border-glass-border px-6 py-5">
        <Link href="/" className="block">
          <div className="text-lg font-bold text-ink">
            AI Visibility
          </div>

          <div className="mt-1 text-xs text-ink-muted">
            AI search visibility platform
          </div>
        </Link>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-5">
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

            <div className="mt-1 truncate text-sm font-semibold text-ink">
              {tenant.name}
            </div>

            <button
              onClick={handleLogout}
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
          className="block rounded-lg bg-primary px-4 py-2.5 text-center text-sm font-medium text-white shadow-md shadow-primary/30 transition hover:bg-primary-hover"
        >
          + Add website
        </Link>
      </div>
    </aside>
  );
}