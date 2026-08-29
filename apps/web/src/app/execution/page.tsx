"use client";

import { useEffect, useState } from "react";

import { toast } from "sonner";

import { authFetch } from "@/lib/auth";
import {
  loadActiveTenant,
  type TenantSummary,
} from "@/lib/tenant";
import Markdown from "@/components/Markdown";
import MarkdownPreview from "@/components/MarkdownPreview";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import { SkeletonCard } from "@/components/Skeleton";

const WORKER_API =
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4000";

/* ========================================
   TYPES
======================================== */

type Tenant = TenantSummary;

type ExecutionTaskType =
  | "content_draft"
  | "entity_fix"
  | "technical_fix";

type ExecutionTaskStatus =
  | "pending"
  | "completed"
  | "failed"
  | "published";

type ExecutionTaskApprovalStatus =
  | "pending"
  | "approved";

type ContentDraftResult = {
  title: string;
  body: string;
  metaTitle: string;
  metaDescription: string;
  faq: { question: string; answer: string }[];
};

type CmsFixResult = {
  success: boolean;
  message: string;
  appliedAt: string;
};

type ExecutionTask = {
  id: string;
  contentPlanId: string | null;
  taskType: ExecutionTaskType;
  title: string;
  description: string | null;
  status: ExecutionTaskStatus;
  approvalStatus: ExecutionTaskApprovalStatus;
  payload: unknown;
  result: ContentDraftResult | CmsFixResult | unknown;
  createdAt: string;
  updatedAt: string;
};

type ExecutionTasksResponse = {
  success: boolean;
  data?: ExecutionTask[];
  error?: string;
};

type MutationResponse = {
  success: boolean;
  error?: string;
};

/* ========================================
   HELPERS
======================================== */

function isContentDraft(
  task: ExecutionTask
): task is ExecutionTask & {
  result: ContentDraftResult;
} {
  return (
    task.taskType === "content_draft" &&
    !!task.result &&
    typeof task.result === "object" &&
    "body" in (task.result as object)
  );
}

function isCmsFixResult(
  value: unknown
): value is CmsFixResult {
  return (
    !!value &&
    typeof value === "object" &&
    "message" in (value as object)
  );
}

function getMarkdownPreviewText(
  task: ExecutionTask
): string {
  return isContentDraft(task)
    ? task.result.body
    : "";
}

function getPlainPreviewText(
  task: ExecutionTask
): string {
  return isCmsFixResult(task.result)
    ? task.result.message
    : "";
}

const TASK_TYPE_LABELS: Record<
  ExecutionTaskType,
  string
> = {
  content_draft: "Content draft",
  entity_fix: "Entity fix",
  technical_fix: "Technical fix",
};

const STATUS_BADGE: Record<
  ExecutionTaskStatus,
  string
> = {
  pending: "bg-muted text-ink-secondary",
  completed: "bg-success-bg text-success-text",
  failed: "bg-danger-bg text-danger-text",
  published: "bg-info-bg text-info-text",
};

const APPROVAL_BADGE: Record<
  ExecutionTaskApprovalStatus,
  string
> = {
  pending: "bg-warning-bg text-warning-text",
  approved: "bg-success-bg text-success-text",
};

/*
 * content-production-agent and technical-fix-
 * agent both throw these exact messages when a
 * tenant simply hasn't reached Stage 2 yet (no
 * plan generated, or generated but not approved).
 * That is expected/normal for a new workspace,
 * not a failure - so it renders as a neutral
 * empty state instead of the red error banner
 * used for actual failures (network errors,
 * unexpected agent/provider errors, etc).
 */
function isMissingContentPlanError(
  message: string
): boolean {
  return (
    message.startsWith(
      "No content plan found"
    ) ||
    message.includes(
      "has not been approved yet"
    )
  );
}

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

/* ========================================
   PAGE
======================================== */

export default function ExecutionPage() {
  const [tenant, setTenant] =
    useState<Tenant | null>(null);

  const [tasks, setTasks] =
    useState<ExecutionTask[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] = useState("");

  const [producing, setProducing] =
    useState(false);

  const [fixing, setFixing] = useState(false);

  const [actionError, setActionError] =
    useState("");

  const [busyTaskId, setBusyTaskId] =
    useState<string | null>(null);

  const [viewingTask, setViewingTask] =
    useState<ExecutionTask | null>(null);

  /* ========================================
     LOAD
  ======================================== */

  async function loadTasks(
    currentTenant?: Tenant
  ) {
    const activeTenant =
      currentTenant ?? tenant;

    if (!activeTenant) {
      return;
    }

    const tasksResponse = await authFetch(
      `${WORKER_API}/api/tenants/${activeTenant.id}/execution-tasks`,
      { cache: "no-store" }
    );

    if (!tasksResponse.ok) {
      throw new Error(
        `Execution tasks API returned ${tasksResponse.status}`
      );
    }

    const tasksResult: ExecutionTasksResponse =
      await tasksResponse.json();

    if (!tasksResult.success) {
      throw new Error(
        tasksResult.error ||
          "Unable to load execution tasks."
      );
    }

    setTasks(tasksResult.data ?? []);
  }

  async function loadPage() {
    try {
      setLoading(true);
      setError("");

      const { tenant: activeTenant } =
        await loadActiveTenant(
          WORKER_API
        );

      if (!activeTenant) {
        throw new Error(
          "No workspace found. Create one to get started."
        );
      }

      setTenant(activeTenant);

      await loadTasks(activeTenant);
    } catch (err) {
      console.error(
        "Failed to load execution page:",
        err
      );

      setError(
        err instanceof Error
          ? err.message
          : "Unable to load execution tasks."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ========================================
     ACTIONS
  ======================================== */

  async function runContentProduction() {
    if (!tenant) {
      return;
    }

    setProducing(true);
    setActionError("");

    try {
      const response = await authFetch(
        `${WORKER_API}/api/tenants/${tenant.id}/stage3-produce`,
        { method: "POST" }
      );

      const result: MutationResponse =
        await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ||
            "Content production failed."
        );
      }

      await loadTasks();
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : "Content production failed."
      );
    } finally {
      setProducing(false);
    }
  }

  async function runTechnicalFixes() {
    if (!tenant) {
      return;
    }

    setFixing(true);
    setActionError("");

    try {
      const response = await authFetch(
        `${WORKER_API}/api/tenants/${tenant.id}/stage3-fix`,
        { method: "POST" }
      );

      const result: MutationResponse =
        await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ||
            "Technical fix run failed."
        );
      }

      await loadTasks();
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : "Technical fix run failed."
      );
    } finally {
      setFixing(false);
    }
  }

  async function approveTask(
    taskId: string
  ) {
    if (!tenant) {
      return;
    }

    setBusyTaskId(taskId);

    try {
      const response = await authFetch(
        `${WORKER_API}/api/tenants/${tenant.id}/execution-tasks/${taskId}/approve`,
        { method: "POST" }
      );

      const result: MutationResponse =
        await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ||
            "Failed to approve task."
        );
      }

      await loadTasks();
      toast.success("Task approved");
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to approve task."
      );
    } finally {
      setBusyTaskId(null);
    }
  }

  async function publishTask(
    taskId: string
  ) {
    if (!tenant) {
      return;
    }

    setBusyTaskId(taskId);

    try {
      const response = await authFetch(
        `${WORKER_API}/api/tenants/${tenant.id}/execution-tasks/${taskId}/publish`,
        { method: "POST" }
      );

      const result: MutationResponse =
        await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ||
            "Failed to publish task."
        );
      }

      await loadTasks();
      toast.success("Task published");
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to publish task."
      );
    } finally {
      setBusyTaskId(null);
    }
  }

  const anyRunning = producing || fixing;

  return (
    <main className="animate-page-in min-h-screen bg-page text-ink">

      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">

        {/* ========================================
           HEADER
        ======================================== */}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">

          <div>

            <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {tenant?.name || "Workspace"}
            </div>

            <h1 className="mt-1 text-2xl font-bold">
              Execution
            </h1>

            <p className="mt-2 max-w-xl text-sm text-ink-muted">
              Produce content drafts and apply
              technical fixes from your approved
              content plan, then review, approve,
              and publish each task.
            </p>

          </div>

          <button
            onClick={loadPage}
            disabled={loading || anyRunning}
            className="w-fit shrink-0 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-medium text-ink-secondary transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>

        </div>

        {/* ========================================
           ACTIONS
        ======================================== */}

        <div className="mt-6 flex flex-col gap-3 rounded-xl border border-border bg-surface shadow-sm p-5 sm:flex-row sm:items-center sm:justify-between">

          <div className="text-sm text-ink-muted">
            Requires an approved Stage 2 content
            plan. Each run can take a little
            while — it calls the AI provider for
            every gap or fix item.
          </div>

          <div className="flex shrink-0 flex-wrap gap-3">

            <button
              type="button"
              onClick={runContentProduction}
              disabled={
                !tenant || producing || fixing
              }
              aria-busy={producing}
              className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-md shadow-primary/20 transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {producing
                ? "Running content production..."
                : "Run Content Production"}
            </button>

            <button
              type="button"
              onClick={runTechnicalFixes}
              disabled={
                !tenant || producing || fixing
              }
              aria-busy={fixing}
              className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm font-medium text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {fixing
                ? "Running technical fixes..."
                : "Run Technical Fixes"}
            </button>

          </div>

        </div>

        {/* ========================================
           ERRORS
        ======================================== */}

        {error && (
          <div className="mt-6 rounded-xl border border-danger-border bg-danger-bg p-5">
            <div className="text-sm font-semibold text-danger-text">
              Execution connection error
            </div>

            <p className="mt-1 text-sm text-danger-text">
              {error}
            </p>
          </div>
        )}

        {actionError &&
          (isMissingContentPlanError(
            actionError
          ) ? (
            <div className="mt-6 rounded-xl border border-border bg-muted p-4">
              <p className="text-sm text-ink-muted">
                {actionError}
              </p>
            </div>
          ) : (
            <div className="mt-6 rounded-xl border border-danger-border bg-danger-bg p-4">
              <p className="text-sm text-danger-text">
                {actionError}
              </p>
            </div>
          ))}

        {/* ========================================
           TASK LIST
        ======================================== */}

        <section className="mt-6 rounded-xl border border-border bg-surface shadow-sm">

          <div className="border-b border-border px-6 py-5">
            <h2 className="text-base font-semibold">
              Execution tasks
            </h2>

            <p className="mt-1 text-sm text-ink-muted">
              Content drafts and fixes generated
              from your content plan.
            </p>
          </div>

          {loading ? (

            <div className="animate-stagger space-y-4 p-6">
              {[1, 2, 3].map((item) => (
                <SkeletonCard
                  key={item}
                  lines={2}
                />
              ))}
            </div>

          ) : tasks.length === 0 ? (

            <EmptyState
              icon="inbox"
              title="No execution tasks yet"
              description="Run content production or technical fixes above to generate your first tasks."
              className="border-0 shadow-none"
            />

          ) : (

            <div className="animate-stagger space-y-4 p-6">
              {tasks.map((task) => {
                const markdownPreview =
                  getMarkdownPreviewText(
                    task
                  );

                const plainPreview =
                  getPlainPreviewText(task);

                const isBusy =
                  busyTaskId === task.id;

                const canApprove =
                  task.approvalStatus ===
                    "pending" &&
                  task.status !== "failed";

                const canPublish =
                  task.taskType ===
                    "content_draft" &&
                  task.approvalStatus ===
                    "approved" &&
                  task.status === "completed";

                return (
                  <article
                    key={task.id}
                    className="glass-card rounded-xl p-5"
                  >

                    {/* TASK HEADER */}

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">

                      <div className="min-w-0">

                        <div className="flex flex-wrap items-center gap-2">

                          <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-ink-secondary">
                            {
                              TASK_TYPE_LABELS[
                                task.taskType
                              ]
                            }
                          </span>

                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${
                              STATUS_BADGE[
                                task.status
                              ]
                            }`}
                          >
                            {task.status}
                          </span>

                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${
                              APPROVAL_BADGE[
                                task
                                  .approvalStatus
                              ]
                            }`}
                          >
                            {task.approvalStatus ===
                            "approved"
                              ? "Approved"
                              : "Approval pending"}
                          </span>

                          <span className="text-xs text-ink-faint">
                            {formatDate(
                              task.createdAt
                            )}
                          </span>

                        </div>

                        <p className="mt-2 text-sm font-semibold leading-6 text-ink">
                          {task.title}
                        </p>

                        {task.description && (
                          <p className="mt-1 text-xs text-ink-muted">
                            {task.description}
                          </p>
                        )}

                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2">

                        <button
                          type="button"
                          onClick={() =>
                            setViewingTask(task)
                          }
                          className="w-fit shrink-0 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20"
                        >
                          View report
                        </button>

                        {canApprove && (
                          <button
                            type="button"
                            onClick={() =>
                              approveTask(task.id)
                            }
                            disabled={isBusy}
                            className="w-fit shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isBusy
                              ? "Approving..."
                              : "Approve"}
                          </button>
                        )}

                        {canPublish && (
                          <button
                            type="button"
                            onClick={() =>
                              publishTask(task.id)
                            }
                            disabled={isBusy}
                            className="w-fit shrink-0 rounded-lg bg-success px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isBusy
                              ? "Publishing..."
                              : "Publish"}
                          </button>
                        )}

                      </div>

                    </div>

                    {/* RESULT PREVIEW */}

                    {markdownPreview && (
                      <MarkdownPreview
                        content={
                          markdownPreview
                        }
                        maxChars={180}
                        className="mt-4"
                      />
                    )}

                    {plainPreview && (
                      <p className="mt-4 line-clamp-2 text-sm leading-6 text-ink-secondary">
                        {plainPreview}
                      </p>
                    )}

                  </article>
                );
              })}
            </div>

          )}

        </section>

      </div>

      {/* ========================================
         VIEW REPORT MODAL
      ======================================== */}

      {viewingTask && (
        <Modal
          title={viewingTask.title}
          subtitle={`${
            TASK_TYPE_LABELS[
              viewingTask.taskType
            ]
          } · ${
            viewingTask.status
          } · Created ${formatDate(
            viewingTask.createdAt
          )}`}
          onClose={() => setViewingTask(null)}
          wide
        >

          <div className="flex flex-wrap items-center gap-2">

            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
                STATUS_BADGE[
                  viewingTask.status
                ]
              }`}
            >
              {viewingTask.status}
            </span>

            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
                APPROVAL_BADGE[
                  viewingTask.approvalStatus
                ]
              }`}
            >
              {viewingTask.approvalStatus ===
              "approved"
                ? "Approved"
                : "Approval pending"}
            </span>

          </div>

          {isContentDraft(viewingTask) ? (

            <>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">

                <div className="rounded-lg border border-border bg-muted p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                    Meta title
                  </div>
                  <div className="mt-1 text-sm text-ink-secondary">
                    {
                      viewingTask.result
                        .metaTitle
                    }
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-muted p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                    Meta description
                  </div>
                  <div className="mt-1 text-sm text-ink-secondary">
                    {
                      viewingTask.result
                        .metaDescription
                    }
                  </div>
                </div>

              </div>

              <div className="mt-4 rounded-xl border border-border-subtle bg-muted p-5">
                <Markdown
                  content={
                    viewingTask.result.body
                  }
                />
              </div>

              {viewingTask.result.faq.length >
                0 && (
                <div className="mt-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                    FAQ
                  </div>

                  <div className="mt-2 flex flex-col gap-2">
                    {viewingTask.result.faq.map(
                      (item, index) => (
                        <div
                          key={index}
                          className="rounded-lg border border-border bg-surface px-3 py-2"
                        >
                          <div className="text-xs font-semibold text-ink-secondary">
                            {item.question}
                          </div>

                          <div className="mt-1 text-xs text-ink-muted">
                            {item.answer}
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}

            </>

          ) : isCmsFixResult(
              viewingTask.result
            ) ? (

            <div className="mt-4 rounded-xl border border-border-subtle bg-muted p-5">
              <p className="text-sm leading-6 text-ink-secondary">
                {viewingTask.result.message}
              </p>

              <p className="mt-3 text-xs text-ink-faint">
                Applied{" "}
                {formatDate(
                  viewingTask.result.appliedAt
                )}
              </p>
            </div>

          ) : (

            <div className="mt-4 rounded-xl border border-border-subtle bg-muted p-5">
              <p className="text-sm text-ink-muted">
                No result data available for this
                task yet.
              </p>
            </div>

          )}

        </Modal>
      )}

    </main>
  );
}
