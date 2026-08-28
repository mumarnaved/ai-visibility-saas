"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { isAuthenticated } from "../lib/auth";

import {
  fetchTenantList,
  resolveActiveTenant,
  setSelectedTenantId,
  type TenantSummary,
} from "../lib/tenant";

import AppNavigation from "./AppNavigation";
import ScanProgressBanner from "./ScanProgressBanner";
import AuthGuard, { PUBLIC_PATHS } from "./AuthGuard";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4000";

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const isPublicPage =
    PUBLIC_PATHS.includes(pathname);

  const [tenant, setTenant] =
    useState<TenantSummary | null>(null);

  const [tenants, setTenants] =
    useState<TenantSummary[]>([]);

  /* ========================================
     LOAD TENANTS

     Single source of truth for the active
     tenant, shared by the sidebar switcher
     (AppNavigation) and the scan-progress
     banner - both render as children of this
     component, so lifting the fetch here
     avoids two independent copies drifting
     out of sync or double-fetching.
  ======================================== */

  async function loadTenants() {
    if (
      isPublicPage ||
      !isAuthenticated()
    ) {
      return;
    }

    try {
      const list = await fetchTenantList(
        API_BASE_URL
      );

      setTenants(list);
      setTenant(
        resolveActiveTenant(list)
      );
    } catch (error) {
      console.error(
        "Failed to load workspaces:",
        error
      );
    }
  }

  useEffect(() => {
    loadTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  /* ========================================
     POLL WHILE THE AUTOMATIC SCAN RUNS

     Runs regardless of which page the user is
     on, since verification (and the redirect
     that follows it) can land the user
     anywhere - not just Overview.
  ======================================== */

  const scanInProgress =
    tenant?.scan_status === "auditing" ||
    tenant?.scan_status === "planning";

  useEffect(() => {
    if (!scanInProgress) {
      return;
    }

    const interval = setInterval(() => {
      loadTenants();
    }, 4000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanInProgress]);

  function handleSwitchTenant(
    tenantId: string
  ) {
    if (tenantId === tenant?.id) {
      return;
    }

    setSelectedTenantId(tenantId);
    window.location.reload();
  }

  return (
    <>
      <AppNavigation
        tenant={tenant}
        tenants={tenants}
        onSwitchTenant={handleSwitchTenant}
      />

      <div
        className={
          isPublicPage
            ? "min-h-screen"
            : "min-h-screen pt-14 lg:pt-0 lg:pl-64"
        }
      >
        <AuthGuard>
          {!isPublicPage && (
            <ScanProgressBanner
              tenant={tenant}
            />
          )}

          {children}
        </AuthGuard>
      </div>
    </>
  );
}
