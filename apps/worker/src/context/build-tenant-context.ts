import type { TenantContext } from "agent-contracts";

import { tenantNamespaces } from "./tenant-manifest.js";
import { tenantSearchPath } from "../database/postgres/migration-runner.js";
import { isDeletedTenantStatus } from "../lib/tenant-status.js";

/* ========================================
   BUILD TENANT CONTEXT

   The ONE place a tenant's runtime context is built. Routes,
   the automatic scan and the job handlers all call this; none
   keeps its own copy of the "tenant-<id>" naming or of the
   schema lookup any more.

   It refuses a tenant that cannot be worked on: unknown,
   failed, still provisioning, suspended, deprovisioning or
   deprovisioned. Only 'active' tenants get a context.

   What it returns (a superset of agent-contracts'
   TenantContext, so agents take it unchanged):
   - the TenantContext fields (tenantId, schema, storagePrefix,
     credentialNamespace, vectorNamespace),
   - db: queries pinned to the tenant's schema with
     search_path "<tenant>", extensions, public,
   - storage: a view of storage confined to the tenant's
     prefix,
   - providers: the metered Firecrawl / SerpApi / OpenRouter
     clients (metering and per-tenant rate limits apply
     through the usage context the orchestrator establishes),
   - plan: the owner's effective plan and limits.
======================================== */

export type TenantUnusableReason =
  | "not_found"
  | "not_active";

export class TenantNotUsableError extends Error {
  readonly reason: TenantUnusableReason;
  readonly status: string | null;

  constructor(
    reason: TenantUnusableReason,
    status: string | null
  ) {
    super(
      reason === "not_found"
        ? "Tenant not found."
        : status !== null && isDeletedTenantStatus(status)
          ? "Workspace was deleted."
          : `Tenant is not active (status: ${status}).`
    );

    this.name = "TenantNotUsableError";
    this.reason = reason;
    this.status = status;
  }
}

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  website_url: string | null;
  schema_name: string;
  status: string;
  plan: string;
}

export interface QueryablePool {
  query(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: any[] }>;
  connect(): Promise<{
    query(
      sql: string,
      params?: unknown[]
    ): Promise<{ rows: any[] }>;
    release(): void;
  }>;
}

export interface TenantStorage {
  write(key: string, content: Buffer | string): Promise<void>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export interface TenantDb {
  schema: string;
  query(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: any[] }>;
}

export interface TenantPlan {
  planTier: string;
  status: string;
  websiteLimit: number;
}

export interface TenantProviders {
  firecrawl: {
    scrape: (url: string) => Promise<unknown>;
  };
  serpapi: {
    siteIndexSignals: (domain: string) => Promise<unknown>;
  };
  openrouter: {
    run: (...args: any[]) => Promise<unknown>;
  };
}

export interface TenantRuntime extends TenantContext {
  userId: string | null;

  tenant: {
    id: string;
    name: string;
    slug: string;
    websiteUrl: string | null;
    status: string;
    plan: string;
  };

  db: TenantDb;
  storage: TenantStorage;
  providers: TenantProviders;
  plan: TenantPlan;
}

export interface BuildTenantContextDeps {
  loadTenant(tenantId: string): Promise<TenantRow | null>;
  pool: QueryablePool;
  rawStorage: {
    write(key: string, content: Buffer | string): Promise<void>;
    read(key: string): Promise<Buffer>;
    delete(key: string): Promise<void>;
    list(prefix: string): Promise<string[]>;
  };
  providers: TenantProviders;
  loadPlan(
    tenantId: string,
    userId: string | null
  ): Promise<TenantPlan>;
}

/* ---------------------------------------- */

const SCHEMA_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/*
 * Reads and writes pinned to one tenant's schema. Each call
 * is its own short transaction so SET LOCAL cannot leak to a
 * pooled connection's next user.
 */
export function createTenantDb(
  pool: QueryablePool,
  schema: string
): TenantDb {
  if (!SCHEMA_NAME.test(schema)) {
    throw new Error("Invalid PostgreSQL identifier.");
  }

  const quoted = `"${schema}"`;

  return {
    schema,

    async query(sql, params) {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(
          `SET LOCAL search_path TO ${tenantSearchPath(quoted)}`
        );

        const result = await client.query(sql, params);

        await client.query("COMMIT");

        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);

        throw error;
      } finally {
        client.release();
      }
    },
  };
}

/*
 * Storage confined to "<prefix>/...": keys are relative, and
 * anything that could step outside the prefix is refused.
 */
export function createTenantStorage(
  raw: BuildTenantContextDeps["rawStorage"],
  prefix: string
): TenantStorage {
  const keyOf = (key: string): string => {
    const normalized = key.replaceAll("\\", "/");

    if (
      !normalized ||
      normalized.startsWith("/") ||
      normalized.split("/").some((part) => part === "..")
    ) {
      throw new Error(`Invalid storage key "${key}".`);
    }

    return `${prefix}/${normalized}`;
  };

  /* async, so a bad key is always a rejected promise, never a sync throw */
  return {
    write: async (key, content) => raw.write(keyOf(key), content),
    read: async (key) => raw.read(keyOf(key)),
    delete: async (key) => raw.delete(keyOf(key)),
    list: async (sub = "") => {
      const full = sub ? keyOf(sub) : prefix;
      const keys = await raw.list(full);

      return keys.map((key) =>
        key.startsWith(`${prefix}/`)
          ? key.slice(prefix.length + 1)
          : key
      );
    },
  };
}

/* ---------------------------------------- */

export async function assertTenantUsable(
  loadTenant: BuildTenantContextDeps["loadTenant"],
  tenantId: string
): Promise<TenantRow> {
  const tenant = await loadTenant(tenantId);

  if (!tenant) {
    throw new TenantNotUsableError("not_found", null);
  }

  if (tenant.status !== "active") {
    throw new TenantNotUsableError("not_active", tenant.status);
  }

  return tenant;
}

export async function buildTenantContextWith(
  deps: BuildTenantContextDeps,
  tenantId: string,
  userId: string | null = null
): Promise<TenantRuntime> {
  const tenant = await assertTenantUsable(
    deps.loadTenant,
    tenantId
  );

  const namespaces = tenantNamespaces(tenant.id);

  return {
    tenantId: tenant.id,
    schema: tenant.schema_name,
    ...namespaces,

    userId,

    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      websiteUrl: tenant.website_url,
      status: tenant.status,
      plan: tenant.plan,
    },

    db: createTenantDb(deps.pool, tenant.schema_name),

    storage: createTenantStorage(
      deps.rawStorage,
      namespaces.storagePrefix
    ),

    providers: deps.providers,

    plan: await deps.loadPlan(tenant.id, userId),
  };
}
