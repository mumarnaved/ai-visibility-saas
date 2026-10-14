import { authFetch } from "./auth";

/* ========================================
   BACKGROUND JOBS

   The worker's Stage 1-4 endpoints no longer
   run the work inside the request: they answer
   202 with a job id and the work runs in the
   background. authFetchJob() keeps the old
   calling convention. It starts the job, polls
   GET .../jobs/:jobId, and resolves with a
   Response shaped like the old synchronous one
   ({ success, data } on success, { success:
   false, error } on failure), so callers only
   swap authFetch for authFetchJob and keep
   their "running" state until it resolves.
======================================== */

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

export interface JobStatusInfo {
  id: string;
  type: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  result: unknown;
  error: string | null;
  lastError: string | null;
}

export interface AuthFetchJobOptions {
  /* Called with every status seen: "queued", "running", ... */
  onStatus?: (status: JobStatus, job?: JobStatusInfo) => void;
  /* First poll interval; it grows to maxPollMs. */
  pollMs?: number;
  maxPollMs?: number;
  /* Give up waiting (the job itself keeps running). */
  timeoutMs?: number;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/* .../api/tenants/<id>/stage1-audit -> .../api/tenants/<id>/jobs/<jobId> */
export function jobStatusUrl(
  startUrl: string,
  jobId: string
): string {
  return `${startUrl.replace(/\/[^/]+$/, "")}/jobs/${jobId}`;
}

export async function authFetchJob(
  input: string,
  init: RequestInit = {},
  options: AuthFetchJobOptions = {}
): Promise<Response> {
  const response = await authFetch(input, init);

  /* Validation, auth and plan errors come back as before. */
  if (response.status !== 202) {
    return response;
  }

  const started = await response.json();
  const jobId: string | undefined = started?.data?.jobId;

  if (!jobId) {
    return json(502, {
      success: false,
      error: "The server did not return a job id.",
    });
  }

  options.onStatus?.("queued");

  const maxPollMs = options.maxPollMs ?? 5000;
  const deadline = Date.now() + (options.timeoutMs ?? 15 * 60 * 1000);
  const statusUrl = jobStatusUrl(input, jobId);

  let delay = options.pollMs ?? 2000;
  let failures = 0;
  let lastStatus: JobStatus = "queued";

  while (Date.now() < deadline) {
    await sleep(delay);
    delay = Math.min(maxPollMs, Math.round(delay * 1.25));

    let poll: Response;

    try {
      poll = await authFetch(statusUrl);
    } catch (error) {
      /* A dropped connection must not lose a job that is still running. */
      if (++failures >= 5) {
        throw error;
      }

      continue;
    }

    if (!poll.ok) {
      if (poll.status >= 500 && ++failures < 5) {
        continue;
      }

      return poll;
    }

    failures = 0;

    const job: JobStatusInfo = (await poll.json()).data;

    if (job.status !== lastStatus) {
      lastStatus = job.status;
      options.onStatus?.(job.status, job);
    }

    if (job.status === "succeeded") {
      return json(201, {
        success: true,
        data: job.result,
        metadata: { operation: job.type, jobId: job.id },
      });
    }

    if (job.status === "failed") {
      return json(422, {
        success: false,
        error: job.error || "The job failed.",
      });
    }
  }

  return json(504, {
    success: false,
    error:
      "This is taking longer than expected. It is still running in the background, so check back in a few minutes.",
  });
}
