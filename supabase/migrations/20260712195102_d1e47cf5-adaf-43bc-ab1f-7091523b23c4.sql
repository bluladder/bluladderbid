-- Harden the process-sms-queue cron job: send the shared cron secret so the
-- now-authenticated function accepts the scheduled invocation. The secret value
-- is the same one already used by the jobber-autosync cron jobs.
SELECT cron.schedule(
  'process-sms-queue',
  '* * * * *',
  $$
  select net.http_post(
    url:='https://gyndziiuizpgwhqwyrvn.supabase.co/functions/v1/process-sms-queue',
    headers:='{"Content-Type": "application/json", "x-cron-secret": "25d64b90b7873a0fe6f4f87fb6ce155905bf2e8c5341c55391e08db2968edaf6"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
  ) as request_id;
  $$
);