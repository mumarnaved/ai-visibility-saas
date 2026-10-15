/* ========================================
   FAKE USAGE + RATE LIMIT TABLES

   Interprets the usage and limiter SQL by the
   usage.<name> / ratelimit.<name> marker comment
   each statement carries, and applies the same
   semantics on in-memory tables, with a
   controllable clock:

   - ratelimit.take refills from updated_at
     (capped at capacity) and spends the cost only
     when enough tokens are there, in one
     synchronous step like the real single
     statement;
   - a rejected take changes nothing.

   The real SQL is verified against Postgres
   separately (see the PR notes); this keeps the
   unit tests fast and free of a database.
======================================== */

export interface FakeUsageEvent {
  tenant_id: string;
  provider: string;
  operation: string;
  units: number;
  cost_estimate: number;
  job_id: string | null;
  success: boolean;
  error: string | null;
  created_at: Date;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class FakeUsageDb {
  events: FakeUsageEvent[] = [];

  buckets = new Map<string, Bucket>();

  now = new Date("2026-10-15T12:00:00.000Z");

  /* Make the next queries of this marker throw. */
  failMarkers = new Set<string>();

  /* Make usage.insert never settle (a hung database). */
  hangInserts = false;

  log: string[] = [];

  advance(seconds: number): void {
    this.now = new Date(this.now.getTime() + seconds * 1000);
  }

  eventsFor(tenantId: string): FakeUsageEvent[] {
    return this.events.filter((e) => e.tenant_id === tenantId);
  }

  async query(
    sql: string,
    params: unknown[] = []
  ): Promise<{ rows: any[] }> {
    const marker = sql.match(
      /\/\* ((?:usage|ratelimit)\.\w+) \*\//
    )?.[1];

    this.log.push(marker ?? "unknown");

    if (marker && this.failMarkers.has(marker)) {
      throw new Error(`simulated ${marker} failure`);
    }

    switch (marker) {
      case "usage.insert": {
        if (this.hangInserts) {
          return new Promise(() => undefined);
        }

        const [
          tenantId,
          provider,
          operation,
          units,
          cost,
          jobId,
          success,
          error,
        ] = params as [
          string,
          string,
          string,
          number,
          number,
          string | null,
          boolean,
          string | null,
        ];

        this.events.push({
          tenant_id: tenantId,
          provider,
          operation,
          units,
          cost_estimate: cost,
          job_id: jobId,
          success,
          error,
          created_at: this.now,
        });

        return { rows: [] };
      }

      case "usage.monthly_totals": {
        const [tenantId, start, end] = params as [
          string,
          Date,
          Date,
        ];

        const groups = new Map<string, FakeUsageEvent[]>();

        for (const e of this.events) {
          if (
            e.tenant_id === tenantId &&
            e.created_at >= start &&
            e.created_at < end
          ) {
            groups.set(e.provider, [
              ...(groups.get(e.provider) ?? []),
              e,
            ]);
          }
        }

        return {
          rows: [...groups].map(([provider, list]) => ({
            provider,
            requests: list.length,
            failed_requests: list.filter((e) => !e.success)
              .length,
            units: String(
              list.reduce((sum, e) => sum + e.units, 0)
            ),
            cost_estimate: String(
              list.reduce((sum, e) => sum + e.cost_estimate, 0)
            ),
          })),
        };
      }

      case "ratelimit.take": {
        const [tenantId, provider, capacity, perSecond, cost] =
          params as [string, string, number, number, number];

        const key = `${tenantId}|${provider}`;
        const nowMs = this.now.getTime();
        const bucket = this.buckets.get(key);

        if (!bucket) {
          this.buckets.set(key, {
            tokens: capacity - cost,
            updatedAt: nowMs,
          });

          return { rows: [{ tokens: capacity - cost }] };
        }

        const refilled = Math.min(
          capacity,
          bucket.tokens +
            Math.max(0, (nowMs - bucket.updatedAt) / 1000) *
              perSecond
        );

        if (refilled < cost) {
          return { rows: [] };
        }

        bucket.tokens = refilled - cost;
        bucket.updatedAt = nowMs;

        return { rows: [{ tokens: bucket.tokens }] };
      }

      case "ratelimit.peek": {
        const [tenantId, provider, capacity, perSecond] =
          params as [string, string, number, number];

        const bucket = this.buckets.get(
          `${tenantId}|${provider}`
        );

        if (!bucket) {
          return { rows: [] };
        }

        return {
          rows: [
            {
              available: Math.min(
                capacity,
                bucket.tokens +
                  Math.max(
                    0,
                    (this.now.getTime() - bucket.updatedAt) /
                      1000
                  ) *
                    perSecond
              ),
            },
          ],
        };
      }

      default:
        throw new Error(
          `FakeUsageDb: unrecognised SQL: ${sql.slice(0, 60)}`
        );
    }
  }
}
