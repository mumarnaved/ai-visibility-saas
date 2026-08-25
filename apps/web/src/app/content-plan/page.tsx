"use client";

import { useEffect, useState } from "react";

import { authFetch } from "@/lib/auth";
import ExpandableJson from "@/components/ExpandableJson";
import ExpandableMarkdown from "@/components/ExpandableMarkdown";

type Tenant = {
  id: string;
  name: string;
  website_url: string;
  status: string;
  plan: string;
};

type TenantResponse = {
  success: boolean;
  data?: Tenant;
  error?: string;
};

type ContentPlan = {
  id: string;
  auditReportId: string | null;
  status: string;
  summary: string | null;
  contentGaps: unknown;
  entityPlan: unknown;
  technicalPlan: unknown;
  roadmap: unknown;
  approvalStatus: string;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ContentPlanResponse = {
  success: boolean;
  data?: ContentPlan;
  error?: string;
};

const WORKER_API =
  "http://localhost:4000";

export default function ContentPlanPage() {
  const [tenant, setTenant] =
    useState<Tenant | null>(null);

  const [plan, setPlan] =
    useState<ContentPlan | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [approving, setApproving] =
    useState(false);

  const [error, setError] =
    useState("");

  const [notFound, setNotFound] =
    useState(false);

  async function loadContentPlan() {
    try {
      setLoading(true);
      setError("");
      setNotFound(false);

      /* ========================================
         LOAD TENANT
      ======================================== */

      const tenantResponse =
        await authFetch(
          `${WORKER_API}/api/tenants/latest`,
          {
            cache: "no-store",
          }
        );

      if (!tenantResponse.ok) {
        throw new Error(
          `Tenant API returned ${tenantResponse.status}`
        );
      }

      const tenantResult: TenantResponse =
        await tenantResponse.json();

      if (
        !tenantResult.success ||
        !tenantResult.data
      ) {
        throw new Error(
          tenantResult.error ||
            "Unable to load workspace."
        );
      }

      const currentTenant =
        tenantResult.data;

      setTenant(currentTenant);

      /* ========================================
         LOAD LATEST CONTENT PLAN
      ======================================== */

      const planResponse =
        await authFetch(
          `${WORKER_API}/api/tenants/${currentTenant.id}/stage2-plan/latest`,
          {
            cache: "no-store",
          }
        );

      if (planResponse.status === 404) {
        setPlan(null);
        setNotFound(true);
        return;
      }

      if (!planResponse.ok) {
        throw new Error(
          `Content plan API returned ${planResponse.status}`
        );
      }

      const planResult: ContentPlanResponse =
        await planResponse.json();

      if (
        !planResult.success ||
        !planResult.data
      ) {
        throw new Error(
          planResult.error ||
            "Unable to load content plan."
        );
      }

      setPlan(planResult.data);
    } catch (err) {
      console.error(
        "Failed to load content plan:",
        err
      );

      setError(
        err instanceof Error
          ? err.message
          : "Unable to load content plan."
      );
    } finally {
      setLoading(false);
    }
  }

  /* ========================================
     APPROVE PLAN
  ======================================== */

  async function approvePlan() {
    if (!tenant || !plan) {
      return;
    }

    try {
      setApproving(true);
      setError("");

      const response =
        await authFetch(
          `${WORKER_API}/api/tenants/${tenant.id}/stage2-plan/${plan.id}/approve`,
          {
            method: "POST",
          }
        );

      const data: ContentPlanResponse =
        await response.json();

      if (
        !response.ok ||
        !data.success ||
        !data.data
      ) {
        throw new Error(
          data.error ||
            `Approve API returned ${response.status}`
        );
      }

      setPlan(data.data);
    } catch (err) {
      console.error(
        "Failed to approve content plan:",
        err
      );

      setError(
        err instanceof Error
          ? err.message
          : "Failed to approve content plan."
      );
    } finally {
      setApproving(false);
    }
  }

  /* ========================================
     INITIAL LOAD
  ======================================== */

  useEffect(() => {
    loadContentPlan();
  }, []);

  /* ========================================
     HELPERS
  ======================================== */

  function formatDate(value: string) {
    try {
      return new Date(
        value
      ).toLocaleString();
    } catch {
      return value;
    }
  }

  const isApproved =
    plan?.approvalStatus === "approved";

  return (
    <main className="min-h-screen bg-page text-ink">

      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">

        {/* ========================================
           HEADER
        ======================================== */}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">

          <div>

            <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {tenant?.name ||
                "Workspace"}
            </div>

            <h1 className="mt-1 text-2xl font-bold">
              Content Plan
            </h1>

            <p className="mt-2 text-sm text-ink-muted">
              Review the latest Stage 2 content plan
              and approve it before it moves forward.
            </p>

          </div>

          <button
            onClick={loadContentPlan}
            disabled={loading}
            className="w-fit rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-medium text-ink-secondary transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? "Loading..."
              : "Refresh"}
          </button>

        </div>

        {/* ========================================
           ERROR
        ======================================== */}

        {error && (
          <div className="mt-6 rounded-xl border border-danger-border bg-danger-bg p-5">

            <div className="text-sm font-semibold text-danger-text">
              Content plan error
            </div>

            <p className="mt-1 text-sm text-danger-text">
              {error}
            </p>

          </div>
        )}

        {/* ========================================
           LOADING
        ======================================== */}

        {loading ? (
          <div className="mt-6 space-y-4">
            <div className="h-32 animate-pulse rounded-xl bg-surface" />
            <div className="h-48 animate-pulse rounded-xl bg-surface" />
          </div>
        ) : notFound ? (

          /* ========================================
             EMPTY STATE
          ======================================== */

          <div className="mt-6 rounded-xl border border-border bg-surface shadow-sm p-10 text-center">

            <div className="text-sm font-semibold">
              No content plan yet
            </div>

            <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
              A Stage 2 content plan hasn&apos;t been
              created for this workspace yet.
            </p>

          </div>
        ) : plan ? (

          <>

            {/* ========================================
               STATUS + APPROVAL
            ======================================== */}

            <section className="mt-6 rounded-xl border border-border bg-surface shadow-sm p-6">

              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">

                <div>

                  <div className="flex flex-wrap items-center gap-2">

                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        isApproved
                          ? "bg-success-bg text-success-text"
                          : "bg-warning-bg text-warning-text"
                      }`}
                    >
                      {isApproved
                        ? "Approved"
                        : "Pending approval"}
                    </span>

                    <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold capitalize text-ink-secondary">
                      {plan.status}
                    </span>

                  </div>

                  {plan.summary ? (
                    <ExpandableMarkdown
                      content={plan.summary}
                      title="Content plan summary"
                      className="mt-3 max-w-2xl"
                    />
                  ) : (
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-secondary">
                      No summary provided for this plan.
                    </p>
                  )}

                  <div className="mt-3 text-xs text-ink-faint">
                    Created{" "}
                    {formatDate(
                      plan.createdAt
                    )}

                    {isApproved &&
                      plan.approvedAt && (
                        <>
                          {" "}
                          &middot; Approved{" "}
                          {formatDate(
                            plan.approvedAt
                          )}
                        </>
                      )}
                  </div>

                </div>

                <button
                  onClick={approvePlan}
                  disabled={
                    approving ||
                    isApproved
                  }
                  className="w-fit shrink-0 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isApproved
                    ? "Approved"
                    : approving
                    ? "Approving..."
                    : "Approve"}
                </button>

              </div>

            </section>

            {/* ========================================
               CONTENT GAPS
            ======================================== */}

            <PlanListSection
              title="Content gaps"
              description="Gaps identified between your current content and the audit findings."
              items={plan.contentGaps}
              emptyText="No content gaps recorded yet."
            />

            {/* ========================================
               ENTITY PLAN
            ======================================== */}

            <PlanListSection
              title="Entity plan"
              description="Entities and topics to reinforce across your content."
              items={plan.entityPlan}
              emptyText="No entity plan recorded yet."
            />

            {/* ========================================
               TECHNICAL PLAN
            ======================================== */}

            <PlanListSection
              title="Technical plan"
              description="Technical follow-ups to pair with the content work."
              items={plan.technicalPlan}
              emptyText="No technical plan recorded yet."
            />

            {/* ========================================
               ROADMAP
            ======================================== */}

            <RoadmapSection
              roadmap={plan.roadmap}
            />

          </>
        ) : null}

      </div>

    </main>
  );
}

/* ========================================
   PLAN LIST SECTION

   contentGaps / entityPlan / technicalPlan
   are stored as raw JSON with no fixed shape
   yet (no generation agent writes them), so
   each item is rendered defensively: common
   title/description fields are used when
   present, otherwise the raw item is shown.
======================================== */

function PlanListSection({
  title,
  description,
  items,
  emptyText,
}: {
  title: string;
  description: string;
  items: unknown;
  emptyText: string;
}) {
  const list = Array.isArray(items)
    ? items
    : [];

  return (
    <section className="mt-6 rounded-xl border border-border bg-surface shadow-sm">

      <div className="border-b border-border px-6 py-5">

        <h2 className="text-base font-semibold">
          {title}
        </h2>

        <p className="mt-1 text-sm text-ink-muted">
          {description}
        </p>

      </div>

      {list.length === 0 ? (

        <div className="p-6 text-sm text-ink-muted">
          {emptyText}
        </div>

      ) : (

        <div className="divide-y divide-border">

          {list.map((item, index) => (
            <PlanListItem
              key={index}
              item={item}
            />
          ))}

        </div>

      )}

    </section>
  );
}

function PlanListItem({
  item,
}: {
  item: unknown;
}) {
  if (
    item &&
    typeof item === "object" &&
    !Array.isArray(item)
  ) {
    const record =
      item as Record<string, unknown>;

    const title =
      typeof record.title === "string"
        ? record.title
        : typeof record.name === "string"
        ? record.name
        : null;

    const description =
      typeof record.description ===
      "string"
        ? record.description
        : typeof record.summary ===
          "string"
        ? record.summary
        : null;

    if (title || description) {
      return (
        <div className="px-6 py-4">

          {title && (
            <div className="text-sm font-semibold text-ink">
              {title}
            </div>
          )}

          {description && (
            <ExpandableMarkdown
              content={description}
              title={title ?? "Details"}
              className="mt-1"
              lines={2}
            />
          )}

        </div>
      );
    }
  }

  return (
    <div className="px-6 py-4">
      <ExpandableJson value={item} title="Item details" lines={2} />
    </div>
  );
}

/* ========================================
   ROADMAP SECTION

   roadmap is a JSON object with no fixed
   shape yet, so its keys are rendered
   generically as a definition list.
======================================== */

function RoadmapSection({
  roadmap,
}: {
  roadmap: unknown;
}) {
  const entries =
    roadmap &&
    typeof roadmap === "object" &&
    !Array.isArray(roadmap)
      ? Object.entries(
          roadmap as Record<
            string,
            unknown
          >
        )
      : [];

  return (
    <section className="mt-6 rounded-xl border border-border bg-surface shadow-sm">

      <div className="border-b border-border px-6 py-5">

        <h2 className="text-base font-semibold">
          Roadmap
        </h2>

        <p className="mt-1 text-sm text-ink-muted">
          Sequencing and timing for the plan above.
        </p>

      </div>

      {entries.length === 0 ? (

        <div className="p-6 text-sm text-ink-muted">
          No roadmap recorded yet.
        </div>

      ) : (

        <div className="grid gap-0 sm:grid-cols-2">

          {entries.map(([key, value]) => (

            <div
              key={key}
              className="border-b border-border p-6 sm:border-r sm:[&:nth-child(even)]:border-r-0"
            >

              <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {key}
              </div>

              <div className="mt-2 text-sm leading-6 text-ink-secondary">
                {typeof value === "string" ||
                typeof value === "number" ||
                typeof value === "boolean"
                  ? String(value)
                  : (
                      <ExpandableJson
                        value={value}
                        title={key}
                        lines={2}
                      />
                    )}
              </div>

            </div>

          ))}

        </div>

      )}

    </section>
  );
}
