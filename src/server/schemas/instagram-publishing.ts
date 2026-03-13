import { z } from "zod";

export const profileConnectionStatusSchema = z.enum([
  "DISCONNECTED",
  "PENDING",
  "CONNECTED",
  "ERROR",
  "EXPIRED",
]);

export const postingPlanStatusSchema = z.enum([
  "RECOMMENDED",
  "SCHEDULED",
  "SKIPPED",
  "PUBLISHED",
  "CANCELLED",
]);

export const postTypeSchema = z.enum(["feed", "story", "reel"]);
export const variantTypeSchema = z.enum(["feed_1x1", "feed_4x5", "story_9x16", "master"]);

export const strategyPillarInputSchema = z.object({
  id: z.uuid().optional(),
  key: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9_]+$/),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(600).optional(),
  target_share_percent: z.number().int().min(0).max(100),
  active: z.boolean().default(true),
  priority: z.number().int().min(0).max(50).default(0),
  supported_post_types: z.array(postTypeSchema).min(1).max(3).default(["feed"]),
});

export const strategySlotTemplateInputSchema = z.object({
  id: z.uuid().optional(),
  pillar_key: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9_]+$/)
    .optional(),
  label: z.string().trim().min(2).max(120),
  weekday: z.number().int().min(0).max(6),
  local_time: z.string().regex(/^\d{2}:\d{2}$/),
  daypart: z.string().trim().min(2).max(40),
  post_type: postTypeSchema,
  variant_type: variantTypeSchema,
  priority: z.number().int().min(0).max(50).default(0),
  active: z.boolean().default(true),
});

export const postingStrategyInputSchema = z
  .object({
    timezone: z.string().trim().min(2).max(64),
    weekly_post_target: z.number().int().min(1).max(30),
    cooldown_hours: z.number().int().min(0).max(168),
    min_ready_assets: z.number().int().min(0).max(50),
    auto_queue_enabled: z.boolean().default(false),
    notes: z.string().trim().max(2000).optional(),
    pillars: z.array(strategyPillarInputSchema).min(1).max(12),
    slot_templates: z.array(strategySlotTemplateInputSchema).min(1).max(42),
  })
  .superRefine((value, ctx) => {
    const totalShare = value.pillars
      .filter((pillar) => pillar.active)
      .reduce((sum, pillar) => sum + pillar.target_share_percent, 0);

    if (totalShare !== 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Active strategy pillar shares must add up to 100.",
        path: ["pillars"],
      });
    }

    const pillarKeys = new Set(value.pillars.map((pillar) => pillar.key));

    for (const slot of value.slot_templates) {
      if (slot.pillar_key && !pillarKeys.has(slot.pillar_key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Slot template pillar "${slot.pillar_key}" does not exist.`,
          path: ["slot_templates"],
        });
      }
    }
  });

export const instagramProfileCreateSchema = z.object({
  model_id: z.uuid(),
  handle: z.string().trim().max(80).optional(),
  display_name: z.string().trim().max(120).optional(),
  timezone: z.string().trim().min(2).max(64).default("UTC"),
  publish_enabled: z.boolean().default(true),
});

export const recommendationAcceptSchema = z.object({
  profile_id: z.uuid(),
  asset_id: z.uuid().optional(),
  caption: z.string().trim().min(1).max(2200).optional(),
  scheduled_at: z.iso.datetime().optional(),
  post_type: postTypeSchema.optional(),
  variant_type: variantTypeSchema.optional(),
});

export const recommendationSkipSchema = z.object({
  reason: z.string().trim().min(3).max(300).optional(),
});

export const instagramOAuthCallbackSchema = z.object({
  state: z.string().trim().min(1),
  code: z.string().trim().min(1).optional(),
  error: z.string().trim().optional(),
  error_description: z.string().trim().optional(),
});
