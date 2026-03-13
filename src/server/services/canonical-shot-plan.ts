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
  imperfectionFingerprint?: Array<Record<string, unknown>> | null;
}): CanonicalShotPlanItem[] {
  const traitSummary = summarizeTraits(input.bodyProfile, input.faceProfile, input.imperfectionFingerprint);

  return (Object.keys(SHOT_DESCRIPTIONS) as RequiredCanonicalShotCode[]).map((shotCode) => {
    const prompt = [
      `Photoreal studio reference image of ${input.modelName}.`,
      SHOT_DESCRIPTIONS[shotCode],
      "Identity lock: match the exact same person as the attached identity references. Preserve skull shape, eye spacing, eye shape, nose structure, lip shape, jaw contour, hairline, skin undertone, and distinctive natural marks.",
      "Strict studio setup: plain seamless gray background, soft diffused key light, no props, no stylized grading.",
      "Natural skin texture, accurate pores, realistic shadow geometry, true-to-life anatomy.",
      "Wardrobe lock: simple fitted plain black top and plain dark denim.",
      "Camera lock: 85mm lens equivalent, neutral white balance, medium depth of field.",
      traitSummary,
      "Do not beautify, de-age, age-shift, ethnicity-shift, or alter facial proportions. Keep makeup minimal and subordinate to identity fidelity.",
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
  imperfectionFingerprint: Array<Record<string, unknown>> | null | undefined,
): string {
  const bodyParts: string[] = [];
  const faceParts: string[] = [];
  const imperfectionParts: string[] = [];

  if (bodyProfile) {
    const skinTone = readString(bodyProfile, "skin_tone");
    const hairColor = readString(bodyProfile, "hair_color");
    const hairLength = readString(bodyProfile, "hair_length");
    const hairStyle = readString(bodyProfile, "hair_style");
    const eyeColor = readString(bodyProfile, "eye_color");
    const build = readString(bodyProfile, "build");
    const distinguishingFeatures = readStringArray(bodyProfile, "distinguishing_features");
    const bodyRatioNotes = readNestedString(bodyProfile, "advanced_traits", "body_ratio_notes");
    const postureSignature = readNestedString(bodyProfile, "advanced_traits", "posture_signature");
    if (skinTone) bodyParts.push(`skin tone ${skinTone}`);
    if (hairColor) bodyParts.push(`hair color ${hairColor}`);
    if (hairLength) bodyParts.push(`hair length ${hairLength}`);
    if (hairStyle) bodyParts.push(`hair style ${hairStyle}`);
    if (eyeColor) bodyParts.push(`eye color ${eyeColor}`);
    if (build) bodyParts.push(`build ${build}`);
    if (distinguishingFeatures.length > 0) bodyParts.push(`distinguishing features ${distinguishingFeatures.join(", ")}`);
    if (bodyRatioNotes) bodyParts.push(`body ratio notes ${bodyRatioNotes}`);
    if (postureSignature) bodyParts.push(`posture signature ${postureSignature}`);
  }

  if (faceProfile) {
    const faceShape = readString(faceProfile, "face_shape");
    const jawline = readString(faceProfile, "jawline");
    const noseProfile = readString(faceProfile, "nose_profile");
    const lipProfile = readString(faceProfile, "lip_profile");
    const browProfile = readString(faceProfile, "brow_profile");
    const eyeSpacing = readString(faceProfile, "eye_spacing");
    const eyeShape = readString(faceProfile, "eye_shape");
    const foreheadHeight = readString(faceProfile, "forehead_height");
    const cheekbones = readString(faceProfile, "cheekbones");
    const smileSignature = readNestedString(faceProfile, "advanced_traits", "smile_signature");
    const gazeSignature = readNestedString(faceProfile, "advanced_traits", "gaze_signature");
    const microAsymmetryNotes = readNestedString(faceProfile, "advanced_traits", "micro_asymmetry_notes");
    if (faceShape) faceParts.push(`face shape ${faceShape}`);
    if (jawline) faceParts.push(`jawline ${jawline}`);
    if (noseProfile) faceParts.push(`nose ${noseProfile}`);
    if (lipProfile) faceParts.push(`lips ${lipProfile}`);
    if (browProfile) faceParts.push(`brows ${browProfile}`);
    if (eyeSpacing) faceParts.push(`eye spacing ${eyeSpacing}`);
    if (eyeShape) faceParts.push(`eye shape ${eyeShape}`);
    if (foreheadHeight) faceParts.push(`forehead ${foreheadHeight}`);
    if (cheekbones) faceParts.push(`cheekbones ${cheekbones}`);
    if (smileSignature) faceParts.push(`smile signature ${smileSignature}`);
    if (gazeSignature) faceParts.push(`gaze signature ${gazeSignature}`);
    if (microAsymmetryNotes) faceParts.push(`micro asymmetry ${microAsymmetryNotes}`);
  }

  for (const item of imperfectionFingerprint ?? []) {
    const type = readString(item, "type");
    const location = readString(item, "location");
    if (!type || !location) continue;
    imperfectionParts.push(`${type} at ${location}`);
  }

  const clauses = [];
  if (bodyParts.length > 0) {
    clauses.push(`Identity body traits: ${bodyParts.join(", ")}.`);
  }
  if (faceParts.length > 0) {
    clauses.push(`Identity face traits: ${faceParts.join(", ")}.`);
  }
  if (imperfectionParts.length > 0) {
    clauses.push(`Identity marks: ${imperfectionParts.join(", ")}.`);
  }

  return clauses.join(" ");
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map(item => item.trim()).slice(0, 6)
    : [];
}

function readNestedString(source: Record<string, unknown>, key: string, nestedKey: string): string | null {
  const nested = source[key];
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return null;
  return readString(nested as Record<string, unknown>, nestedKey);
}
