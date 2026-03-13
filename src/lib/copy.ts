export const FRIENDLY_TERM_MAP = {
  "Canonical Pack": "Reference Set",
  "Front-shot Candidate": "Front Look Option",
  Provider: "Image Engine",
  "Model ID": "Engine Version",
  Workflow: "Setup Flow",
  "Batch Generation": "Multi-shot Run",
  Moderation: "Review",
  Artifact: "Visual Glitch",
  Drift: "Look Mismatch",
} as const;

const TERM_REPLACERS: Array<{ from: RegExp; to: string }> = [
  { from: /\bCanonical Pack\b/gi, to: FRIENDLY_TERM_MAP["Canonical Pack"] },
  { from: /\bFront-shot Candidate\b/gi, to: FRIENDLY_TERM_MAP["Front-shot Candidate"] },
  { from: /\bProvider\b/gi, to: FRIENDLY_TERM_MAP.Provider },
  { from: /\bModel ID\b/gi, to: FRIENDLY_TERM_MAP["Model ID"] },
  { from: /\bWorkflow\b/gi, to: FRIENDLY_TERM_MAP.Workflow },
  { from: /\bBatch Generation\b/gi, to: FRIENDLY_TERM_MAP["Batch Generation"] },
  { from: /\bModeration\b/gi, to: FRIENDLY_TERM_MAP.Moderation },
  { from: /\bArtifact\b/gi, to: FRIENDLY_TERM_MAP.Artifact },
  { from: /\bDrift\b/gi, to: FRIENDLY_TERM_MAP.Drift },
];

export function applyFriendlyTerms(input: string): string {
  return TERM_REPLACERS.reduce((value, term) => value.replace(term.from, term.to), input);
}

export const DISALLOWED_JARGON = [
  "canonical pack",
  "front-shot candidate",
  "provider",
  "model id",
  "workflow",
  "batch generation",
  "moderation",
  "artifact",
  "drift",
] as const;
