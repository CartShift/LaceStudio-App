import type { RequiredCanonicalShotCode } from "@/server/services/model-workflow.service";

const SHOT_DESCRIPTIONS: Record<RequiredCanonicalShotCode, string> = {
  frontal_closeup: "frontal close-up portrait, neutral expression, straight gaze",
  left45_closeup: "45-degree left close-up portrait, neutral expression",
  right45_closeup: "45-degree right close-up portrait, neutral expression",
  neutral_head_shoulders: "head and shoulders portrait, neutral pose and gaze",
  half_body_front: "half-body front-facing portrait with relaxed posture",
  full_body_front: "full-body front-facing portrait, natural standing pose",
  soft_smile_closeup: "close-up portrait with a soft smile",
  serious_closeup: "close-up portrait with serious expression and relaxed jaw",
};

export type CanonicalShotPlanItem = {
  shot_code: RequiredCanonicalShotCode;
  prompt: string;
};

export function buildCanonicalShotPlan(input: {
  modelName: string;
  bodyProfile?: Record<string, unknown> | null;
  faceProfile?: Record<string, unknown> | null;
}): CanonicalShotPlanItem[] {
  const traitSummary = summarizeTraits(input.bodyProfile, input.faceProfile);

  return (Object.keys(SHOT_DESCRIPTIONS) as RequiredCanonicalShotCode[]).map((shotCode) => {
    const prompt = [
      `Photoreal studio reference image of ${input.modelName}.`,
      SHOT_DESCRIPTIONS[shotCode],
      "Strict studio setup: plain seamless gray background, soft diffused key light, no props, no stylized grading.",
      "Natural skin texture, accurate pores, realistic shadow geometry, true-to-life anatomy.",
      "Wardrobe lock: simple fitted plain black top and plain dark denim.",
      "Camera lock: 85mm lens equivalent, neutral white balance, medium depth of field.",
      traitSummary,
      "No artistic effects, no text, no watermark, no surreal elements.",
    ]
      .filter(Boolean)
      .join(" ");

    return {
      shot_code: shotCode,
      prompt,
    };
  });
}

function summarizeTraits(
  bodyProfile: Record<string, unknown> | null | undefined,
  faceProfile: Record<string, unknown> | null | undefined,
): string {
  const bodyParts: string[] = [];
  const faceParts: string[] = [];

  if (bodyProfile) {
    const hairColor = readString(bodyProfile, "hair_color");
    const eyeColor = readString(bodyProfile, "eye_color");
    const build = readString(bodyProfile, "build");
    if (hairColor) bodyParts.push(`hair color ${hairColor}`);
    if (eyeColor) bodyParts.push(`eye color ${eyeColor}`);
    if (build) bodyParts.push(`build ${build}`);
  }

  if (faceProfile) {
    const faceShape = readString(faceProfile, "face_shape");
    const jawline = readString(faceProfile, "jawline");
    const cheekbones = readString(faceProfile, "cheekbones");
    if (faceShape) faceParts.push(`face shape ${faceShape}`);
    if (jawline) faceParts.push(`jawline ${jawline}`);
    if (cheekbones) faceParts.push(`cheekbones ${cheekbones}`);
  }

  const clauses = [];
  if (bodyParts.length > 0) {
    clauses.push(`Identity body traits: ${bodyParts.join(", ")}.`);
  }
  if (faceParts.length > 0) {
    clauses.push(`Identity face traits: ${faceParts.join(", ")}.`);
  }

  return clauses.join(" ");
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
