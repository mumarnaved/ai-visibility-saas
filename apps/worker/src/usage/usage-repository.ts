import {
  PROVIDER_RATES,
  USAGE_PROVIDERS,
  type UsageProvider,
} from "./usage-rates.js";

/* ========================================
   USAGE REPOSITORY

   platform.usage_events reads and writes. Takes
   any { query } so tests can pass a fake and
   production passes the lazy pool adapter.
======================================== */

export interface UsageQueryable {
  query(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: any[] }>;
}

export interface UsageEventInput {
  tenantId: string;
  jobId: string | null;
  provider: UsageProvider;
  operation: string;
  units: number;
  costEstimate: number;
  success: boolean;
  error: string | null;
}

export interface ProviderUsageTotals {
  provider: UsageProvider;
  unit: string;
  requests: number;
  failedRequests: number;
  units: number;
  costEstimate: number;
}

export interface MonthlyUsage {
  period: {
    label: string;
    start: string;
    end: string;
  };
  providers: ProviderUsageTotals[];
  totalCostEstimate: number;
  currency: "USD";
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isTenantUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

/* Start (inclusive) and end (exclusive) of the UTC month holding `at`. */
export function monthBounds(at: Date): {
  start: Date;
  end: Date;
  label: string;
} {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();

  return {
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 1)),
    label: `${year}-${String(month + 1).padStart(2, "0")}`,
  };
}

export function createUsageRepository(
  db: UsageQueryable
) {
  async function recordEvent(
    event: UsageEventInput
  ): Promise<void> {
    await db.query(
      `
        /* usage.insert */
        INSERT INTO platform.usage_events
          (tenant_id, provider, operation, units, cost_estimate, job_id, success, error)
        VALUES
          ($1::uuid, $2, $3, $4, $5, $6::uuid, $7, $8)
      `,
      [
        event.tenantId,
        event.provider,
        event.operation,
        event.units,
        event.costEstimate,
        event.jobId,
        event.success,
        event.error,
      ]
    );
  }

  /*
   * Totals per provider for the UTC month holding
   * `at`. tenant_id is part of the WHERE clause,
   * so one tenant can never read another's
   * numbers. Every known provider is returned
   * (zero-filled) so the UI has a stable shape.
   */
  async function getMonthlyUsage(
    tenantId: string,
    at: Date = new Date()
  ): Promise<MonthlyUsage> {
    const { start, end, label } = monthBounds(at);

    const result = await db.query(
      `
        /* usage.monthly_totals */
        SELECT
          provider,
          COUNT(*)::int AS requests,
          COUNT(*) FILTER (WHERE NOT success)::int AS failed_requests,
          COALESCE(SUM(units), 0) AS units,
          COALESCE(SUM(cost_estimate), 0) AS cost_estimate
        FROM platform.usage_events
        WHERE tenant_id = $1::uuid
          AND created_at >= $2
          AND created_at < $3
        GROUP BY provider
      `,
      [tenantId, start, end]
    );

    const byProvider = new Map<string, any>(
      result.rows.map((row) => [row.provider, row])
    );

    const providers: ProviderUsageTotals[] =
      USAGE_PROVIDERS.map((provider) => {
        const row = byProvider.get(provider);

        return {
          provider,
          unit: PROVIDER_RATES[provider].unit,
          requests: Number(row?.requests ?? 0),
          failedRequests: Number(
            row?.failed_requests ?? 0
          ),
          units: Number(row?.units ?? 0),
          costEstimate: Number(
            row?.cost_estimate ?? 0
          ),
        };
      });

    return {
      period: {
        label,
        start: start.toISOString(),
        end: end.toISOString(),
      },
      providers,
      totalCostEstimate: providers.reduce(
        (sum, p) => sum + p.costEstimate,
        0
      ),
      currency: "USD",
    };
  }

  return { recordEvent, getMonthlyUsage };
}

export type UsageRepository = ReturnType<
  typeof createUsageRepository
>;
