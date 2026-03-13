-- Run in Supabase SQL editor after deployment.

select cron.schedule(
  'lacestudio-publish-scheduled',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.publish_url', true),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
  $$
);

select cron.schedule(
  'lacestudio-ingest-analytics',
  '0 */6 * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.analytics_url', true),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
  $$
);
