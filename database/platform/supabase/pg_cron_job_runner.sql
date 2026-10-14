-- Safety net for the job queue: every minute, ask the worker to drain
-- platform.jobs. The worker already kicks the runner right after a job is
-- enqueued; this catches a lost kick, jobs waiting out a retry backoff, and
-- jobs left "running" by an invocation that hit the function timeout.
--
-- NOT a migration (it lives outside database/platform/migrations on purpose).
-- Run it yourself in the Supabase SQL editor, once, AFTER migration 010 has
-- been applied.
--
-- Before running, replace the two placeholders below:
--   <WORKER_URL>    e.g. https://ai-visibility-saas-worker.vercel.app  (no trailing slash)
--   <CRON_SECRET>   the same value as the CRON_SECRET env var on the worker
--
-- The secret ends up in cron.job. If you would rather not keep it in plain
-- text, store it in Supabase Vault and build the header from
-- vault.decrypted_secrets instead.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Re-running this file replaces the job instead of duplicating it.
do $$
begin
  perform cron.unschedule('run-job-queue');
exception when others then
  null; -- not scheduled yet
end $$;

select cron.schedule(
  'run-job-queue',
  '* * * * *',
  $job$
    select net.http_post(
      url     := '<WORKER_URL>/api/jobs/run',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <CRON_SECRET>'
      ),
      body    := '{}'::jsonb,
      -- The runner works for up to ~250s; keep the connection open that long.
      timeout_milliseconds := 300000
    )
    -- Only call the worker when there is something to do.
    where exists (
      select 1
      from platform.jobs
      where (status = 'queued'  and run_at <= now())
         or (status = 'running' and locked_at < now() - interval '360 seconds')
    );
  $job$
);

-- Check it:
--   select jobid, jobname, schedule, active from cron.job where jobname = 'run-job-queue';
--   select status, return_message, start_time from cron.job_run_details
--     where jobid = (select jobid from cron.job where jobname = 'run-job-queue')
--     order by start_time desc limit 10;
--   select id, status, error from net._http_response order by created desc limit 5;
--
-- Remove it:
--   select cron.unschedule('run-job-queue');
