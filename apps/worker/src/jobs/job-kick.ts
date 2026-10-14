import { waitUntil } from "@vercel/functions";

/* ========================================
   KICK THE RUNNER

   After a job is enqueued, start draining the
   queue right away by calling this worker's own
   POST /api/jobs/run. It is deliberately not
   awaited by the request that enqueued the job:

   - on Vercel the call is handed to waitUntil(),
     so it still goes out after the 202 response
     is sent, instead of being frozen with the
     function;
   - the caller only waits long enough for the
     runner to receive the request (KICK_WINDOW_MS)
     and then drops the connection; the runner
     keeps going on its own.

   If the kick is lost, the pg_cron safety net
   (database/platform/supabase/pg_cron_job_runner.sql)
   picks the job up within a minute.
======================================== */

const KICK_WINDOW_MS = 3_000;

export function workerBaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string {
  const explicit = env.WORKER_PUBLIC_URL?.trim();

  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  const production = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();

  if (production) {
    return `https://${production}`;
  }

  return `http://localhost:${env.PORT ?? env.API_PORT ?? 4000}`;
}

async function callRunner(): Promise<void> {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    /* The runner endpoint refuses to run without it. */
    return;
  }

  try {
    await fetch(`${workerBaseUrl()}/api/jobs/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(KICK_WINDOW_MS),
    });
  } catch {
    /* Aborting after the window is expected; the runner continues. */
  }
}

/* Replaceable in tests. */
export const jobKick = {
  run(): void {
    const call = callRunner();

    if (process.env.VERCEL) {
      waitUntil(call);
    } else {
      void call;
    }
  },
};
