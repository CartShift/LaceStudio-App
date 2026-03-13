import { z } from "zod";
import { getEnv } from "@/lib/env";
import { ApiError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { personalityProfileSchema, socialTracksSchema } from "@/server/schemas/model-workflow";
import { resolvePublishingAssetPreviewUrl } from "@/server/services/publishing-assets";
import type { CaptionCopySource, CaptionSeoPackage, PostType, StrategyPrimaryGoal, VariantType } from "@/types/domain";

type PersonalityProfile = z.infer<typeof personalityProfileSchema>;
type SocialTracksProfile = z.infer<typeof socialTracksSchema>;

type CopyAssetContext = {
  id: string;
  sequenceNumber: number;
  promptText: string;
  issueTags: string[];
  previewUrl: string | null;
  campaign: {
    id: string;
    name: string;
    promptText: string | null;
  } | null;
} | null;

type CopyPillarContext = {
  key: string | null;
  name: string;
  description: string | null;
};

export type PublishingCopyContext = {
  profileId: string;
  displayName: string;
  handle: string | null;
  postType: PostType;
  variantType: VariantType;
  scheduledAt: Date;
  daypart: string;
  primaryGoal: StrategyPrimaryGoal;
  strategyNotes: string | null;
  pillar: CopyPillarContext;
  experimentTag: string | null;
  personality: unknown;
  socialTracks: unknown;
  asset: CopyAssetContext;
};

export type PublishingCopyResult = {
  caption: string;
  captionPackage: CaptionSeoPackage;
  source: CaptionCopySource;
};

type NormalizedPublishingCopyContext = PublishingCopyContext & {
  personality: PersonalityProfile;
  socialTracks: SocialTracksProfile;
};

type ZaiChatCompletionPayload = {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{
            type?: string;
            text?: string;
          }>;
    };
  }>;
};

const DEFAULT_PERSONALITY = personalityProfileSchema.parse({
  social_voice: "warm",
  temperament: "confident",
  interests: ["fashion", "editorial styling"],
  boundaries: ["No explicit content", "No political endorsements"],
  communication_style: {
    caption_tone: "aspirational",
    emoji_usage: "minimal",
    language_style: "balanced",
  },
  notes: "",
});

const DEFAULT_SOCIAL_TRACKS = socialTracksSchema.parse({
  reality_like_daily: {
    enabled: true,
    style_brief: "Natural day-in-the-life visuals with realistic settings.",
    prompt_bias: "candid framing, handheld realism, daylight",
    target_ratio_percent: 60,
    weekly_post_goal: 3,
  },
  fashion_editorial: {
    enabled: true,
    style_brief: "High-polish fashion shots with premium editorial styling.",
    prompt_bias: "studio precision, clean compositions, luxury tone",
    target_ratio_percent: 40,
    weekly_post_goal: 2,
  },
});

const COPY_TIMEOUT_MS = 20_000;
const MAX_CAPTION_LENGTH = 2200;
const MIN_HASHTAGS_BY_POST_TYPE: Record<PostType, number> = {
  feed: 5,
  reel: 5,
  story: 0,
};
const MAX_HASHTAGS_BY_POST_TYPE: Record<PostType, number> = {
  feed: 8,
  reel: 8,
  story: 3,
};

const GENERIC_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "along",
  "around",
  "asset",
  "because",
  "behind",
  "built",
  "camera",
  "campaign",
  "cinematic",
  "clean",
  "close",
  "content",
  "daylight",
  "editorial",
  "fashion",
  "frame",
  "high",
  "identity",
  "image",
  "instagram",
  "lighting",
  "look",
  "luxury",
  "magazine",
  "model",
  "moment",
  "motion",
  "mood",
  "original",
  "photo",
  "post",
  "premium",
  "quality",
  "realistic",
  "scene",
  "scroll",
  "share",
  "shoot",
  "short",
  "social",
  "someone",
  "stop",
  "story",
  "style",
  "styled",
  "talent",
  "that",
  "their",
  "this",
  "tone",
  "vertical",
  "video",
  "views",
  "visual",
  "with",
  "worth",
]);

function defaultVariantForPostType(postType: PostType): VariantType {
  if (postType === "story") return "story_9x16";
  if (postType === "reel") return "reel_9x16";
  return "feed_4x5";
}

function inferDaypart(date: Date): string {
  const hour = date.getUTCHours();
  if (hour < 11) return "morning";
  if (hour < 15) return "midday";
  if (hour < 18) return "afternoon";
  return "evening";
}

function normalizePersonality(raw: unknown): PersonalityProfile {
  const parsed = personalityProfileSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_PERSONALITY;
}

function normalizeSocialTracks(raw: unknown): SocialTracksProfile {
  const parsed = socialTracksSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_SOCIAL_TRACKS;
}

function normalizeGoal(raw: unknown): StrategyPrimaryGoal {
  return raw === "top_of_funnel" || raw === "business_conversion" ? raw : "balanced_growth";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function extractExperimentTag(raw: unknown): string | null {
  const metadata = asRecord(raw);
  return typeof metadata?.experiment_tag === "string" && metadata.experiment_tag.trim()
    ? metadata.experiment_tag.trim()
    : null;
}

function pickFallbackPillar(input: {
  postType: PostType;
  pillars: Array<{
    key: string;
    name: string;
    description: string | null;
    active: boolean;
    priority: number;
    supported_post_types: PostType[];
  }>;
}): CopyPillarContext {
  const compatible = input.pillars
    .filter((pillar) => pillar.active && pillar.supported_post_types.includes(input.postType))
    .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name));

  const selected = compatible[0];
  if (!selected) {
    return {
      key: null,
      name: "Open Slot",
      description: null,
    };
  }

  return {
    key: selected.key,
    name: selected.name,
    description: selected.description,
  };
}

export async function resolvePublishingCopyContext(input: {
  profileId: string;
  planItemId?: string;
  assetId?: string;
  postType?: PostType;
  variantType?: VariantType;
  scheduledAt?: Date;
}): Promise<PublishingCopyContext> {
  const [profile, strategy, planItem] = await Promise.all([
    prisma.instagramProfile.findUnique({
      where: { id: input.profileId },
      include: {
        model: {
          select: {
            name: true,
            personality_profile: true,
            social_tracks_profile: true,
          },
        },
      },
    }),
    prisma.postingStrategy.findUnique({
      where: { profile_id: input.profileId },
      include: {
        pillars: true,
      },
    }),
    input.planItemId
      ? prisma.postingPlanItem.findUnique({
          where: { id: input.planItemId },
          include: {
            pillar: true,
          },
        })
      : Promise.resolve(null),
  ]);

  if (!profile) {
    throw new ApiError(404, "NOT_FOUND", "Instagram profile not found.");
  }

  if (planItem && planItem.profile_id !== input.profileId) {
    throw new ApiError(400, "VALIDATION_ERROR", "The selected recommendation belongs to a different Instagram profile.");
  }

  const targetAssetId = input.assetId ?? planItem?.asset_id ?? undefined;
  const asset = targetAssetId
    ? await prisma.asset.findUnique({
        where: { id: targetAssetId },
        select: {
          id: true,
          sequence_number: true,
          prompt_text: true,
          issue_tags: true,
          raw_gcs_uri: true,
          approved_gcs_uri: true,
          campaign: {
            select: {
              id: true,
              name: true,
              prompt_text: true,
            },
          },
        },
      })
    : null;

  const previewUrl = asset
    ? await resolvePublishingAssetPreviewUrl(asset.approved_gcs_uri ?? asset.raw_gcs_uri)
    : null;
  const postType = input.postType ?? planItem?.post_type ?? "feed";
  const variantType = input.variantType ?? planItem?.variant_type ?? defaultVariantForPostType(postType);
  const scheduledAt = input.scheduledAt ?? planItem?.slot_start ?? new Date(Date.now() + 2 * 60 * 60 * 1000);
  const pillar =
    planItem?.pillar
      ? {
          key: planItem.pillar.key,
          name: planItem.pillar.name,
          description: planItem.pillar.description,
        }
      : planItem?.pillar_key
        ? {
            key: planItem.pillar_key,
            name:
              strategy?.pillars.find((entry) => entry.key === planItem.pillar_key)?.name ??
              humanizeValue(planItem.pillar_key),
            description:
              strategy?.pillars.find((entry) => entry.key === planItem.pillar_key)?.description ?? null,
          }
        : pickFallbackPillar({
            postType,
            pillars: strategy?.pillars ?? [],
          });

  return {
    profileId: profile.id,
    displayName: profile.display_name ?? profile.model.name,
    handle: profile.handle,
    postType,
    variantType,
    scheduledAt,
    daypart: inferDaypart(scheduledAt),
    primaryGoal: normalizeGoal(strategy?.primary_goal),
    strategyNotes: strategy?.notes ?? null,
    pillar,
    experimentTag: extractExperimentTag(planItem?.autopilot_metadata),
    personality: normalizePersonality(profile.model.personality_profile),
    socialTracks: normalizeSocialTracks(profile.model.social_tracks_profile),
    asset: asset
      ? {
          id: asset.id,
          sequenceNumber: asset.sequence_number,
          promptText: asset.prompt_text,
          issueTags: asset.issue_tags,
          previewUrl,
          campaign: asset.campaign
            ? {
                id: asset.campaign.id,
                name: asset.campaign.name,
                promptText: asset.campaign.prompt_text,
              }
            : null,
        }
      : null,
  };
}

export async function generatePublishingCopy(input: {
  profileId: string;
  planItemId?: string;
  assetId?: string;
  postType?: PostType;
  variantType?: VariantType;
  scheduledAt?: Date;
}): Promise<PublishingCopyResult> {
  const context = await resolvePublishingCopyContext(input);
  return buildPublishingCopyFromContext({
    context,
    mode: "vision_refined",
    fallbackSource: "metadata_fallback",
  });
}

export async function buildPublishingCopyFromContext(input: {
  context: PublishingCopyContext;
  mode: "metadata_draft" | "vision_refined";
  fallbackSource?: CaptionCopySource;
}): Promise<PublishingCopyResult> {
  const context = {
    ...input.context,
    personality: normalizePersonality(input.context.personality),
    socialTracks: normalizeSocialTracks(input.context.socialTracks),
  } satisfies NormalizedPublishingCopyContext;

  if (input.mode === "metadata_draft") {
    const captionPackage = buildDeterministicCaptionPackage(context, "metadata_draft");
    return {
      caption: captionPackage.caption,
      captionPackage,
      source: "metadata_draft",
    };
  }

  const visionCaption = await tryZaiVisionCopy(context);
  if (visionCaption) {
    return {
      caption: visionCaption.caption,
      captionPackage: visionCaption,
      source: "vision_refined",
    };
  }

  const textCaption = await tryZaiTextCopy(context);
  if (textCaption) {
    return {
      caption: textCaption.caption,
      captionPackage: textCaption,
      source: "metadata_fallback",
    };
  }

  const fallbackSource = input.fallbackSource ?? "metadata_fallback";
  const captionPackage = buildDeterministicCaptionPackage(context, fallbackSource);
  return {
    caption: captionPackage.caption,
    captionPackage,
    source: fallbackSource,
  };
}

function buildDeterministicSeed(context: NormalizedPublishingCopyContext) {
  const focusTopics = extractFocusTopics(context);
  const styleHint = resolveStyleHint(context);
  const hook = buildHook(context, focusTopics, styleHint);
  const body = buildBody(context, focusTopics, styleHint);
  const callToAction = buildCallToAction(context);
  const hashtags = buildHashtags(context, focusTopics);
  const primaryKeyword = buildPrimaryKeyword(context, focusTopics);
  const strategyAlignment = buildStrategyAlignment(context);
  const complianceSummary = buildComplianceSummary(context);
  const rationale = context.experimentTag
    ? `This draft reserves room for experiment "${context.experimentTag}" while staying consistent with ${context.pillar.name.toLowerCase()} coverage.`
    : `This draft aligns ${context.postType} format, ${context.daypart} timing, and ${context.pillar.name.toLowerCase()} strategy coverage.`;

  return {
    primary_keyword: primaryKeyword,
    hook,
    body,
    call_to_action: callToAction,
    hashtags,
    rationale,
    strategy_alignment: strategyAlignment,
    compliance_summary: complianceSummary,
  };
}

function buildDeterministicCaptionPackage(context: NormalizedPublishingCopyContext, source: CaptionCopySource): CaptionSeoPackage {
  return normalizeCaptionPackage(buildDeterministicSeed(context), context, source);
}

function buildHook(context: NormalizedPublishingCopyContext, focusTopics: string[], styleHint: string): string {
  const focus = focusTopics[0] ?? context.pillar.name.toLowerCase();
  const voice = context.personality.social_voice;
  const tone = context.personality.communication_style.caption_tone;

  if (context.postType === "story") {
    return `${context.displayName} is checking in with a ${styleHint} ${focus} moment.`;
  }

  if (context.postType === "reel") {
    if (tone === "storytelling") {
      return `${context.displayName} turns ${focus} into a reel that feels immediate without losing polish.`;
    }
    if (voice === "bold") {
      return `${context.displayName} just made ${focus} look sharp enough to stop the scroll.`;
    }
    return `${context.displayName} moves this ${focus} scene with ${styleHint} confidence.`;
  }

  if (tone === "editorial") {
    return `${context.displayName} in a ${styleHint} frame built to carry ${focus}.`;
  }

  return `${context.displayName} just posted a ${styleHint} frame worth saving for ${focus}.`;
}

function buildBody(context: NormalizedPublishingCopyContext, focusTopics: string[], styleHint: string): string {
  const interestSlice = context.personality.interests.slice(0, 2).map((entry) => entry.toLowerCase());
  const focusLine = focusTopics.length
    ? `Built around ${focusTopics.slice(0, 3).join(", ")}.`
    : `Built to reinforce ${context.pillar.name.toLowerCase()} coverage.`;
  const interestLine = interestSlice.length
    ? `It keeps the profile close to ${interestSlice.join(" and ")} without breaking the established voice.`
    : `It stays inside the profile's established ${styleHint} voice.`;

  if (context.personality.communication_style.language_style === "concise") {
    return `${focusLine} ${interestLine}`.trim();
  }

  if (context.personality.communication_style.caption_tone === "storytelling") {
    return `${focusLine} ${context.displayName} keeps the tone ${context.personality.temperament.toLowerCase()} and easy to read for the ${context.daypart} window. ${interestLine}`.trim();
  }

  return `${focusLine} ${interestLine}`.trim();
}

function buildCallToAction(context: NormalizedPublishingCopyContext): string {
  if (context.postType === "story") {
    return "Reply with the version you want next.";
  }

  if (context.postType === "reel") {
    return context.personality.communication_style.caption_tone === "casual"
      ? "Send this to the person who would style it the same way."
      : "Share this with the person who would save the look instantly.";
  }

  return context.primaryGoal === "business_conversion"
    ? "Save this and tap back when you need the reference."
    : "Save this for your next moodboard and send it to a friend.";
}

function buildPrimaryKeyword(context: NormalizedPublishingCopyContext, focusTopics: string[]): string {
  const focus = focusTopics.slice(0, 2).join(" ");
  return `${context.displayName} ${focus || context.pillar.name}`.toLowerCase().replace(/\s+/g, " ").trim();
}

function buildStrategyAlignment(context: NormalizedPublishingCopyContext): string {
  const primaryGoalStr = context.primaryGoal ?? "balanced_growth";
  const goalLabel = typeof primaryGoalStr === "string" ? primaryGoalStr.replaceAll("_", " ") : "balanced growth";
  const pillarLabel = context.pillar.name.toLowerCase();
  return `Optimize for ${goalLabel} through ${pillarLabel} in the ${context.daypart} ${context.postType} window.`;
}

function buildComplianceSummary(context: NormalizedPublishingCopyContext): string {
  const boundaries = context.personality.boundaries.length
    ? context.personality.boundaries.slice(0, 3).join("; ")
    : "No explicit content or unsafe claims";
  return `Respect boundaries: ${boundaries}. Keep claims grounded to the visible post context and stay under Instagram caption limits.`;
}

function resolveStyleHint(context: NormalizedPublishingCopyContext): string {
  if (context.pillar.key?.includes("editorial")) {
    return "editorial";
  }

  if (context.pillar.key?.includes("story") || context.pillar.key?.includes("relationship")) {
    return "personal";
  }

  if (context.pillar.key?.includes("reel")) {
    return "dynamic";
  }

  return context.personality.communication_style.caption_tone === "editorial" ? "editorial" : "polished";
}

function extractFocusTopics(context: NormalizedPublishingCopyContext): string[] {
  const candidates = [
    context.asset?.campaign?.name ?? "",
    context.asset?.campaign?.promptText ?? "",
    context.asset?.promptText ?? "",
    context.pillar.description ?? "",
    resolveTrackBrief(context),
  ];

  const counts = new Map<string, number>();
  for (const value of candidates) {
    for (const token of tokenizeForTopics(value)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([token]) => token)
    .slice(0, 4);
}

function tokenizeForTopics(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 4 && !GENERIC_STOP_WORDS.has(entry));
}

function resolveTrackBrief(context: NormalizedPublishingCopyContext): string {
  if (context.pillar.key?.includes("editorial")) {
    return context.socialTracks.fashion_editorial.style_brief;
  }

  return context.socialTracks.reality_like_daily.style_brief;
}

function buildHashtags(context: NormalizedPublishingCopyContext, focusTopics: string[]): string[] {
  const base = [
    context.handle?.replace(/^@/, "") ?? context.displayName,
    context.pillar.key ?? context.pillar.name,
    context.postType === "reel" ? "reelstyle" : context.postType === "story" ? "storyupdate" : "editorialfeed",
    ...focusTopics,
    ...context.personality.interests.slice(0, 2),
    context.primaryGoal === "top_of_funnel" ? "discovermore" : context.primaryGoal === "business_conversion" ? "saveforlater" : "contentstrategy",
  ];

  return normalizeHashtags(base, context.postType);
}

function normalizeHashtags(values: string[], postType: PostType, exclusions: string[] = []): string[] {
  const blocked = new Set(
    exclusions
      .map((entry) => sanitizeHashtag(entry))
      .filter(Boolean)
      .map((entry) => entry.toLowerCase()),
  );
  const normalized = values
    .map((entry) => sanitizeHashtag(entry))
    .filter((entry) => Boolean(entry) && !blocked.has(entry.toLowerCase()));
  const unique = Array.from(new Set(normalized.map((entry) => entry.toLowerCase()))).map((lower) =>
    normalized.find((entry) => entry.toLowerCase() === lower) as string,
  );

  const maxCount = MAX_HASHTAGS_BY_POST_TYPE[postType];
  const minCount = MIN_HASHTAGS_BY_POST_TYPE[postType];
  const padded = [...unique];

  while (padded.length < minCount) {
    padded.push(`generic${padded.length + 1}`);
  }

  return padded.slice(0, maxCount).map((entry) => `#${entry}`);
}

function sanitizeHashtag(value: string): string {
  return value
    .replace(/^#/, "")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28);
}

export function formatCaptionFromPackage(captionPackage: Pick<CaptionSeoPackage, "caption" | "hook" | "body" | "call_to_action" | "hashtags">): string {
  if (captionPackage.caption.trim()) {
    return captionPackage.caption.trim();
  }

  const segments = [captionPackage.hook, captionPackage.body, captionPackage.call_to_action]
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (captionPackage.hashtags.length > 0) {
    segments.push(captionPackage.hashtags.join(" "));
  }

  return segments.join("\n\n").trim();
}

function normalizeCaptionPackage(
  raw: Partial<CaptionSeoPackage>,
  context: NormalizedPublishingCopyContext,
  source: CaptionCopySource,
): CaptionSeoPackage {
  const deterministic = buildDeterministicSeed(context);
  const exclusions = buildCaptionExclusions(context);
  const hook = normalizeSentence(
    sanitizeCaptionText(raw.hook ?? raw.opening_hook ?? deterministic.hook, exclusions) || deterministic.hook,
  );
  const body = normalizeSentence(
    sanitizeCaptionText(raw.body ?? deterministic.body, exclusions) || deterministic.body,
  );
  const callToAction = normalizeSentence(
    sanitizeCaptionText(raw.call_to_action ?? deterministic.call_to_action, exclusions) || deterministic.call_to_action,
  );
  const primaryKeyword = normalizeText(
    sanitizeCaptionText(raw.primary_keyword ?? deterministic.primary_keyword, exclusions) || deterministic.primary_keyword,
    120,
  );
  const rationale = normalizeText(
    sanitizeCaptionText(raw.rationale ?? deterministic.rationale, exclusions) || deterministic.rationale,
    320,
  );
  const strategyAlignment = normalizeText(
    sanitizeCaptionText(raw.strategy_alignment ?? deterministic.strategy_alignment, exclusions) || deterministic.strategy_alignment,
    240,
  );
  const complianceSummary = normalizeText(raw.compliance_summary ?? deterministic.compliance_summary, 260);
  const hashtags = normalizeHashtags(
    [
      ...(raw.hashtags ?? []),
      ...deterministic.hashtags,
    ],
    context.postType,
    exclusions,
  );

  const caption = clampCaptionLength(
    [hook, body, callToAction, hashtags.join(" ")]
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join("\n\n"),
  );

  return {
    caption,
    primary_keyword: primaryKeyword,
    hook,
    opening_hook: hook,
    body,
    call_to_action: callToAction,
    hashtags,
    rationale,
    strategy_alignment: strategyAlignment,
    compliance_summary: complianceSummary,
    source,
  };
}

function buildCaptionExclusions(context: NormalizedPublishingCopyContext): string[] {
  const issueTags = context.asset?.issueTags ?? [];
  const boundaryTerms = context.personality.boundaries.flatMap((entry) => normalizeBoundaryToExcludedPhrases(entry));

  return Array.from(
    new Set(
      [...issueTags, ...boundaryTerms]
        .map((entry) => entry.replace(/\s+/g, " ").trim())
        .filter((entry) => entry.length >= 3)
        .map((entry) => entry.toLowerCase()),
    ),
  );
}

function normalizeBoundaryToExcludedPhrases(boundary: string): string[] {
  const normalized = boundary.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) return [];

  const stripped = normalized
    .replace(/^(?:do not|don't|never)\s+/i, "")
    .replace(/^(?:no|avoid|without)\s+/i, "")
    .trim();

  return Array.from(new Set([normalized, stripped].filter((entry) => entry.length >= 3)));
}

function sanitizeCaptionText(value: string, exclusions: string[]): string {
  let sanitized = value;

  for (const exclusion of exclusions) {
    sanitized = sanitized.replace(new RegExp(escapeRegExp(exclusion), "ig"), "");
  }

  return sanitized
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSentence(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}.`;
}

function normalizeText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? normalized.slice(0, maxLength).trim() : normalized;
}

function clampCaptionLength(value: string): string {
  if (value.length <= MAX_CAPTION_LENGTH) return value.trim();

  const [withoutHashtags, hashtags] = splitCaptionAndHashtags(value);
  let trimmedHashtags = hashtags;
  let next = [withoutHashtags, trimmedHashtags].filter(Boolean).join("\n\n").trim();

  while (next.length > MAX_CAPTION_LENGTH && trimmedHashtags.includes(" ")) {
    trimmedHashtags = trimmedHashtags.split(" ").slice(0, -1).join(" ");
    next = [withoutHashtags, trimmedHashtags].filter(Boolean).join("\n\n").trim();
  }

  if (next.length <= MAX_CAPTION_LENGTH) return next;
  return `${withoutHashtags.slice(0, Math.max(0, MAX_CAPTION_LENGTH - 1)).trim()}…`;
}

function splitCaptionAndHashtags(value: string): [string, string] {
  const blocks = value.split(/\n{2,}/);
  const lastBlock = blocks[blocks.length - 1] ?? "";
  if (!lastBlock.includes("#")) {
    return [value, ""];
  }

  return [blocks.slice(0, -1).join("\n\n").trim(), lastBlock.trim()];
}

async function tryZaiVisionCopy(context: NormalizedPublishingCopyContext): Promise<CaptionSeoPackage | null> {
  let env: ReturnType<typeof getEnv>;
  try {
    env = getEnv();
  } catch {
    return null;
  }

  if (!env.ZAI_API_KEY || !env.ZAI_VISION_MODEL || !context.asset?.previewUrl) {
    return null;
  }

  try {
    const response = await fetchWithTimeout(
      `${env.ZAI_API_BASE_URL.trim().replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.ZAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: env.ZAI_VISION_MODEL,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: buildVisionPrompt(context),
                },
                {
                  type: "image_url",
                  image_url: {
                    url: context.asset.previewUrl,
                  },
                },
              ],
            },
          ],
        }),
      },
      COPY_TIMEOUT_MS,
    );

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as ZaiChatCompletionPayload;
    const text = extractZaiMessageText(payload);
    if (!text) return null;

    const parsed = parseJsonObjectFromText(text);
    if (!parsed) return null;

    return normalizeCaptionPackage(parsed as Partial<CaptionSeoPackage>, context, "vision_refined");
  } catch {
    return null;
  }
}

async function tryZaiTextCopy(context: NormalizedPublishingCopyContext): Promise<CaptionSeoPackage | null> {
  let env: ReturnType<typeof getEnv>;
  try {
    env = getEnv();
  } catch {
    return null;
  }

  if (!env.ZAI_API_KEY || !env.ZAI_TEXT_MODEL) {
    return null;
  }

  try {
    const response = await fetchWithTimeout(
      `${env.ZAI_API_BASE_URL.trim().replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.ZAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: env.ZAI_TEXT_MODEL,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: buildMetadataPrompt(context),
                },
              ],
            },
          ],
        }),
      },
      COPY_TIMEOUT_MS,
    );

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as ZaiChatCompletionPayload;
    const text = extractZaiMessageText(payload);
    if (!text) return null;

    const parsed = parseJsonObjectFromText(text);
    if (!parsed) return null;

    return normalizeCaptionPackage(parsed as Partial<CaptionSeoPackage>, context, "metadata_fallback");
  } catch {
    return null;
  }
}

function buildMetadataPrompt(context: NormalizedPublishingCopyContext): string {
  const hashtagTarget = `${MIN_HASHTAGS_BY_POST_TYPE[context.postType]}-${MAX_HASHTAGS_BY_POST_TYPE[context.postType]}`;
  return [
    "Write strategic Instagram copy as strict JSON only.",
    `Profile display name: ${context.displayName}`,
    `Profile handle: ${context.handle ?? "none"}`,
    `Post type: ${context.postType}`,
    `Variant type: ${context.variantType}`,
    `Daypart: ${context.daypart}`,
    `Primary goal: ${context.primaryGoal}`,
    `Pillar: ${context.pillar.name}`,
    `Pillar description: ${context.pillar.description ?? "none"}`,
    `Strategy notes: ${context.strategyNotes ?? "none"}`,
    `Personality voice: ${context.personality.social_voice}`,
    `Temperament: ${context.personality.temperament}`,
    `Caption tone: ${context.personality.communication_style.caption_tone}`,
    `Emoji usage: ${context.personality.communication_style.emoji_usage}`,
    `Language style: ${context.personality.communication_style.language_style}`,
    `Interests: ${context.personality.interests.join(", ") || "none"}`,
    `Boundaries: ${context.personality.boundaries.join("; ") || "none"}`,
    `Reality track: ${context.socialTracks.reality_like_daily.style_brief}`,
    `Editorial track: ${context.socialTracks.fashion_editorial.style_brief}`,
    `Campaign name: ${context.asset?.campaign?.name ?? "none"}`,
    `Campaign prompt: ${context.asset?.campaign?.promptText ?? "none"}`,
    `Asset prompt: ${context.asset?.promptText ?? "none"}`,
    `Asset issue tags to avoid mentioning: ${context.asset?.issueTags.join(", ") || "none"}`,
    `Experiment tag: ${context.experimentTag ?? "none"}`,
    `Hashtag target: ${hashtagTarget} hashtags for this post type.`,
    "Do not invent visual details that are not present in the supplied metadata.",
    "Respect the boundaries as hard exclusions.",
    "Return JSON with keys primary_keyword, hook, body, call_to_action, hashtags, rationale, strategy_alignment, compliance_summary.",
  ].join("\n");
}

function buildVisionPrompt(context: NormalizedPublishingCopyContext): string {
  const hashtagTarget = `${MIN_HASHTAGS_BY_POST_TYPE[context.postType]}-${MAX_HASHTAGS_BY_POST_TYPE[context.postType]}`;
  return [
    "You are writing Instagram copy from a single approved post preview.",
    `Profile display name: ${context.displayName}`,
    `Profile handle: ${context.handle ?? "none"}`,
    `Post type: ${context.postType}`,
    `Variant type: ${context.variantType}`,
    `Daypart: ${context.daypart}`,
    `Primary goal: ${context.primaryGoal}`,
    `Pillar: ${context.pillar.name}`,
    `Pillar description: ${context.pillar.description ?? "none"}`,
    `Strategy notes: ${context.strategyNotes ?? "none"}`,
    `Personality voice: ${context.personality.social_voice}`,
    `Temperament: ${context.personality.temperament}`,
    `Caption tone: ${context.personality.communication_style.caption_tone}`,
    `Emoji usage: ${context.personality.communication_style.emoji_usage}`,
    `Language style: ${context.personality.communication_style.language_style}`,
    `Interests: ${context.personality.interests.join(", ") || "none"}`,
    `Boundaries: ${context.personality.boundaries.join("; ") || "none"}`,
    `Reality track: ${context.socialTracks.reality_like_daily.style_brief}`,
    `Editorial track: ${context.socialTracks.fashion_editorial.style_brief}`,
    `Campaign name: ${context.asset?.campaign?.name ?? "none"}`,
    `Campaign prompt: ${context.asset?.campaign?.promptText ?? "none"}`,
    `Asset prompt: ${context.asset?.promptText ?? "none"}`,
    `Experiment tag: ${context.experimentTag ?? "none"}`,
    `Hashtag target: ${hashtagTarget} hashtags for this post type.`,
    "Only mention details that are clearly visible in the image or directly supported by the metadata.",
    "Do not mention issue tags or flaws unless they are needed for compliance avoidance.",
    "Respect the boundaries as hard exclusions.",
    "Return JSON with keys primary_keyword, hook, body, call_to_action, hashtags, rationale, strategy_alignment, compliance_summary.",
  ].join("\n");
}

function extractZaiMessageText(payload: ZaiChatCompletionPayload): string | null {
  for (const choice of payload.choices ?? []) {
    const content = choice.message?.content;
    if (typeof content === "string" && content.trim()) {
      return content.trim();
    }

    if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part.text === "string" && part.text.trim()) {
          return part.text.trim();
        }
      }
    }
  }

  return null;
}

function parseJsonObjectFromText(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const direct = parseJsonObject(trimmed);
  if (direct) return direct;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    const parsed = parseJsonObject(fenced.trim());
    if (parsed) return parsed;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return parseJsonObject(trimmed.slice(start, end + 1));
  }

  return null;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function humanizeValue(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.replaceAll("_", " ").replace(/\b\w/g, (entry) => entry.toUpperCase());
}
