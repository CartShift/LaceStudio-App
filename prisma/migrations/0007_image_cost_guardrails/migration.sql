-- Align generation cost guardrails with current provider pricing.
INSERT INTO "system_settings" ("key", "value")
VALUES
  ('gpu_monthly_budget_usd', '900.00'::jsonb),
  ('image_cost_per_1k_gpu_usd', '0.035'::jsonb),
  ('image_cost_per_1k_openai_usd', '0.17'::jsonb),
  ('image_cost_per_1k_nano_banana_2_usd', '0.03'::jsonb)
ON CONFLICT ("key")
DO UPDATE SET "value" = EXCLUDED."value";
