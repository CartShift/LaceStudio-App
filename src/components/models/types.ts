export type WorkflowStep = "character_design" | "personality" | "social_strategy" | "reference_studio" | "review";

export type CharacterDesignDraft = {
  body_profile: {
    height_cm: number;
    build: "petite" | "slim" | "athletic" | "curvy" | "muscular" | "average";
    skin_tone: string;
    hair_color: string;
    hair_length: "shaved" | "short" | "medium" | "long" | "very_long";
    hair_style: string;
    eye_color: string;
    distinguishing_features: string[];
    advanced_traits: {
      shoulder_width: "narrow" | "balanced" | "broad";
      body_ratio_notes?: string;
      posture_signature?: string;
    };
  };
  face_profile: {
    face_shape: "oval" | "round" | "square" | "heart" | "diamond" | "oblong";
    jawline: "soft" | "defined" | "angular";
    nose_profile: "straight" | "aquiline" | "button" | "wide" | "narrow";
    lip_profile: "thin" | "balanced" | "full";
    brow_profile: "straight" | "arched" | "soft_arch";
    eye_spacing: "close" | "balanced" | "wide";
    eye_shape: "almond" | "round" | "hooded" | "monolid";
    forehead_height: "short" | "balanced" | "tall";
    cheekbones: "soft" | "defined" | "prominent";
    advanced_traits: {
      smile_signature?: string;
      gaze_signature?: string;
      micro_asymmetry_notes?: string;
    };
  };
  imperfection_fingerprint: Array<{
    type: string;
    location: string;
    intensity: number;
  }>;
};

export type PersonalityDraft = {
  social_voice: "warm" | "witty" | "playful" | "minimal" | "bold";
  temperament: "calm" | "energetic" | "mysterious" | "confident" | "soft";
  interests: string[];
  boundaries: string[];
  communication_style: {
    caption_tone: "casual" | "editorial" | "storytelling" | "aspirational";
    emoji_usage: "none" | "minimal" | "moderate";
    language_style: "concise" | "balanced" | "expressive";
  };
  notes?: string;
};

export type SocialTracksDraft = {
  reality_like_daily: {
    enabled: boolean;
    style_brief: string;
    prompt_bias?: string;
    target_ratio_percent: number;
    weekly_post_goal: number;
  };
  fashion_editorial: {
    enabled: boolean;
    style_brief: string;
    prompt_bias?: string;
    target_ratio_percent: number;
    weekly_post_goal: number;
  };
};

export type CanonicalCandidate = {
  id: string;
  model_id: string;
  pack_version: number;
  shot_code: string;
  candidate_index: number;
  seed: number;
  prompt_text: string;
  image_gcs_uri: string;
  preview_image_url?: string | null;
  realism_score: number | null;
  clarity_score: number | null;
  consistency_score: number | null;
  composite_score: number | null;
  status: "CANDIDATE" | "SELECTED" | "REJECTED";
};

export type CanonicalPackSummary = {
  pack_version: number;
  status: "NOT_STARTED" | "GENERATING" | "READY" | "APPROVED" | "FAILED";
  error?: string | null;
  error_request_id?: string | null;
  progress?: {
    completed_shots: number;
    total_shots: number;
    generated_candidates: number;
  };
  generation?: {
    mode?: "front_only" | "remaining" | "full";
    provider?: "openai" | "nano_banana_2" | "zai_glm" | "gpu";
    provider_model_id?: string;
    candidates_per_shot?: number;
    started_at?: string;
    heartbeat_at?: string;
    failed_shots?: number;
    shot_codes?: string[];
    resume_available?: boolean;
    completed_shot_codes?: string[];
    missing_shot_codes?: string[];
    current_shot_code?: string;
    current_shot_started_at?: string;
  };
  shots: Array<{
    shot_code: string;
    recommended_candidate_id?: string;
    candidates: CanonicalCandidate[];
  }>;
};

export type ModelPhotoImportStatus = "IDLE" | "UPLOADING" | "ANALYZING" | "READY" | "FAILED";

export type ModelPhotoImportSuggestion = {
  character_design: CharacterDesignDraft;
  personality: PersonalityDraft;
  social_strategy: SocialTracksDraft;
  confidence: {
    character_design: number;
    personality: number;
    social_strategy: number;
  };
  warnings: string[];
  image_reviews: Array<{
    reference_id: string;
    accepted: boolean;
    reason?: string;
    solo_subject?: boolean;
    face_visible?: boolean;
    view_angle?: "frontal" | "left_45" | "right_45" | "left_profile" | "right_profile" | "unknown";
    framing?: "closeup" | "head_shoulders" | "half_body" | "full_body" | "unknown";
    expression?: "neutral" | "soft_smile" | "serious" | "other";
    sharpness_score?: number;
    identity_anchor_score?: number;
  }>;
};

export type ModelSourceReferenceItem = {
  id: string;
  image_gcs_uri: string;
  preview_url: string | null;
  status: "PENDING" | "ACCEPTED" | "REJECTED";
  rejection_reason: string | null;
  file_name: string | null;
  mime_type: string;
  byte_size: number;
  sort_order: number;
  created_at: string;
};

export type ModelPhotoImportSnapshot = {
  job_id: string | null;
  status: ModelPhotoImportStatus;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  analysis_provider: "zai_vision" | "openai_vision" | "gemini_fallback" | "heuristic" | null;
  counts: {
    pending: number;
    accepted: number;
    rejected: number;
    total: number;
  };
  options: {
    keep_as_references: boolean;
    auto_generate_on_apply: boolean;
    canonical_provider?: "openai" | "nano_banana_2" | "zai_glm" | "gpu";
    canonical_model_id?: string;
    canonical_candidates_per_shot: number;
  };
  references: ModelSourceReferenceItem[];
  latest_suggestion: ModelPhotoImportSuggestion | null;
};

export function createDefaultCharacterDraft(): CharacterDesignDraft {
  return {
    body_profile: {
      height_cm: 172,
      build: "athletic",
      skin_tone: "light olive",
      hair_color: "dark brown",
      hair_length: "long",
      hair_style: "soft wave",
      eye_color: "brown",
      distinguishing_features: [],
      advanced_traits: {
        shoulder_width: "balanced",
      },
    },
    face_profile: {
      face_shape: "oval",
      jawline: "defined",
      nose_profile: "straight",
      lip_profile: "balanced",
      brow_profile: "soft_arch",
      eye_spacing: "balanced",
      eye_shape: "almond",
      forehead_height: "balanced",
      cheekbones: "defined",
      advanced_traits: {},
    },
    imperfection_fingerprint: [],
  };
}

export function createDefaultPersonalityDraft(): PersonalityDraft {
  return {
    social_voice: "warm",
    temperament: "confident",
    interests: ["fashion", "fitness"],
    boundaries: ["No explicit content", "No political endorsements"],
    communication_style: {
      caption_tone: "aspirational",
      emoji_usage: "minimal",
      language_style: "balanced",
    },
    notes: "",
  };
}

export function createDefaultSocialTracksDraft(): SocialTracksDraft {
  return {
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
  };
}
