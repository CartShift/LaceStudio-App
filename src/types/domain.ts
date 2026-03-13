export type ModelStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";
export type CampaignStatus =
  | "DRAFT"
  | "GENERATING"
  | "REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "SCHEDULED"
  | "PUBLISHED"
  | "FAILED";

export type GenerationJobStatus = "DISPATCHED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "TIMED_OUT";

export type PublishingStatus =
  | "PENDING_APPROVAL"
  | "SCHEDULED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "RETRY"
  | "FAILED"
  | "REJECTED"
  | "CANCELLED";

export type InstagramProfileConnectionStatus =
  | "DISCONNECTED"
  | "PENDING"
  | "CONNECTED"
  | "ERROR"
  | "EXPIRED";

export type PostingPlanStatus =
  | "RECOMMENDED"
  | "SCHEDULED"
  | "SKIPPED"
  | "PUBLISHED"
  | "CANCELLED";

export type AssetStatus = "PENDING" | "APPROVED" | "REJECTED";
export type PostType = "feed" | "story" | "reel";
export type VariantType = "feed_1x1" | "feed_4x5" | "story_9x16" | "master";

export type ImageModelProvider = "gpu" | "openai" | "nano_banana_2" | "zai_glm";

export type ModelWorkflowStep = "character_design" | "personality" | "social_strategy";
export type CanonicalPackStatus = "NOT_STARTED" | "GENERATING" | "READY" | "APPROVED" | "FAILED";
export type ModelReferenceCandidateStatus = "CANDIDATE" | "SELECTED" | "REJECTED";
export type ModelSourceReferenceStatus = "PENDING" | "ACCEPTED" | "REJECTED";
export type ModelPhotoImportStatus = "IDLE" | "UPLOADING" | "ANALYZING" | "READY" | "FAILED";

export type CanonicalShotCode =
  | "frontal_closeup"
  | "left45_closeup"
  | "right45_closeup"
  | "neutral_head_shoulders"
  | "half_body_front"
  | "full_body_front"
  | "soft_smile_closeup"
  | "serious_closeup";

export type ModelWorkflowState = {
  current_step: ModelWorkflowStep;
  completed_steps: ModelWorkflowStep[];
  last_saved_at?: string;
};

export type CanonicalPackCandidate = {
  id: string;
  model_id: string;
  pack_version: number;
  shot_code: CanonicalShotCode;
  candidate_index: number;
  seed: number;
  prompt_text: string;
  image_gcs_uri: string;
  status: ModelReferenceCandidateStatus;
  realism_score?: number;
  clarity_score?: number;
  consistency_score?: number;
  composite_score?: number;
};

export type CanonicalPackSummary = {
  pack_version: number;
  status: CanonicalPackStatus;
  shots: Array<{
    shot_code: CanonicalShotCode;
    recommended_candidate_id?: string;
    candidates: CanonicalPackCandidate[];
  }>;
};

export type CreativeIssueTag =
  | "pose_error"
  | "face_drift"
  | "lighting_mismatch"
  | "artifact"
  | "wardrobe_issue"
  | "expression_mismatch"
  | "composition_issue";

export type StrategyPillar = {
  id?: string;
  key: string;
  name: string;
  description?: string | null;
  target_share_percent: number;
  active: boolean;
  priority: number;
  supported_post_types: PostType[];
};

export type StrategySlotTemplate = {
  id?: string;
  pillar_key?: string | null;
  label: string;
  weekday: number;
  local_time: string;
  daypart: string;
  post_type: PostType;
  variant_type: VariantType;
  priority: number;
  active: boolean;
};

export type PostingStrategy = {
  id?: string;
  profile_id: string;
  timezone: string;
  weekly_post_target: number;
  cooldown_hours: number;
  min_ready_assets: number;
  auto_queue_enabled: boolean;
  notes?: string | null;
  pillars: StrategyPillar[];
  slot_templates: StrategySlotTemplate[];
};

export type PostingPlanItem = {
  id: string;
  profile_id: string;
  strategy_id?: string | null;
  pillar_id?: string | null;
  pillar_key?: string | null;
  asset_id?: string | null;
  status: PostingPlanStatus;
  slot_start: string;
  slot_end?: string | null;
  post_type: PostType;
  variant_type: VariantType;
  rationale?: string | null;
  confidence?: number | null;
  caption_suggestion?: string | null;
  decided_at?: string | null;
  asset?: {
    id: string;
    sequence_number: number;
    campaign?: {
      id: string;
      name: string;
    } | null;
  } | null;
};

export type ProfilePublishingHealth = {
  cadence_score: number;
  approved_assets_ready: number;
  scheduled_count: number;
  pending_approval_count: number;
  failed_count: number;
  recommendation_count: number;
  stale_analytics: boolean;
  warnings: string[];
};

export type InstagramProfileSummary = {
  id: string;
  model_id: string;
  model_name: string;
  handle: string | null;
  display_name: string | null;
  timezone: string;
  connection_status: InstagramProfileConnectionStatus;
  graph_user_id_preview: string | null;
  publish_enabled: boolean;
  token_expires_at: string | null;
  last_analytics_sync_at: string | null;
  strategy: {
    weekly_post_target: number;
    cooldown_hours: number;
    min_ready_assets: number;
    active_pillars: number;
    slot_count: number;
  } | null;
  health: ProfilePublishingHealth;
  last_post: {
    publishing_queue_id: string;
    published_at: string;
    reach: number;
    engagement_rate: number;
    pillar_key?: string | null;
  } | null;
  next_posts: PostingPlanItem[];
};
