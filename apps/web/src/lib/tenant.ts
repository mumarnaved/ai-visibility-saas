import { authFetch } from "./auth";

/* ========================================
   TYPES

   Mirrors the raw (snake_case) shape every
   page already expects from
   /api/tenants/latest - GET /api/tenants
   returns the same columns, just as a list.
======================================== */

export type ScanStatus =
  | "not_started"
  | "auditing"
  | "planning"
  | "ready"
  | "failed";

export type TenantSummary = {
  id: string;
  slug: string;
  name: string;
  website_url: string;
  schema_name: string;
  status: string;
  plan: string;
  verification_token: string | null;
  domain_verified_at: string | null;
  scan_status: ScanStatus;
  scan_error: string | null;
  created_at: string;
  updated_at: string;
};

type TenantListResponse = {
  success: boolean;
  data?: TenantSummary[];
  error?: string;
};

/* ========================================
   SELECTED TENANT (localStorage)
======================================== */

const SELECTED_TENANT_KEY =
  "ai_visibility_selected_tenant_id";

export function getSelectedTenantId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(
    SELECTED_TENANT_KEY
  );
}

export function setSelectedTenantId(
  tenantId: string
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    SELECTED_TENANT_KEY,
    tenantId
  );
}

/* ========================================
   FETCH TENANT LIST
======================================== */

export async function fetchTenantList(
  apiBase: string
): Promise<TenantSummary[]> {
  const response = await authFetch(
    `${apiBase}/api/tenants`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error(
      `Tenant list API returned ${response.status}`
    );
  }

  const result: TenantListResponse =
    await response.json();

  if (!result.success) {
    throw new Error(
      result.error ||
        "Unable to load workspaces."
    );
  }

  return result.data ?? [];
}

/* ========================================
   RESOLVE ACTIVE TENANT

   Prefers the tenant the user explicitly
   selected (persisted in localStorage). Falls
   back to the newest tenant - which also
   covers a selection that no longer belongs
   to this user (stale id, switched accounts).
======================================== */

export function resolveActiveTenant(
  tenants: TenantSummary[]
): TenantSummary | null {
  if (tenants.length === 0) {
    return null;
  }

  const selectedId =
    getSelectedTenantId();

  const selected = selectedId
    ? tenants.find(
        (tenant) =>
          tenant.id === selectedId
      )
    : undefined;

  return selected ?? tenants[0];
}

/* ========================================
   LOAD ACTIVE TENANT

   Convenience wrapper combining the two
   calls above - what every page's loader
   actually wants.
======================================== */

export async function loadActiveTenant(
  apiBase: string
): Promise<{
  tenant: TenantSummary | null;
  tenants: TenantSummary[];
}> {
  const tenants = await fetchTenantList(
    apiBase
  );

  return {
    tenant: resolveActiveTenant(tenants),
    tenants,
  };
}
