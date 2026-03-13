function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function resolveRequestedCampaignModelIds(input: { model_id?: string; model_ids?: string[] }): string[] {
  const requested = input.model_ids?.length ? input.model_ids : input.model_id ? [input.model_id] : [];
  return [...new Set(requested)];
}

export function normalizeCampaignBaseName(name: string, modelName?: string | null): string {
  let nextName = name.trim();

  if (modelName) {
    const modelSuffix = ` · ${modelName}`;
    if (nextName.endsWith(modelSuffix)) {
      nextName = nextName.slice(0, -modelSuffix.length).trim();
    }
  }

  if (nextName.endsWith(" Copy")) {
    nextName = nextName.slice(0, -" Copy".length).trim();
  }

  return nextName || name.trim();
}

export function buildDuplicateCampaignName(input: {
  sourceName: string;
  sourceModelName?: string | null;
  targetModelName: string;
  targetCount: number;
  overrideName?: string;
}): string {
  const baseName = (input.overrideName?.trim() || normalizeCampaignBaseName(input.sourceName, input.sourceModelName)).trim();

  if (input.targetCount > 1) {
    return `${baseName} · ${input.targetModelName}`;
  }

  if (input.sourceModelName && input.sourceModelName === input.targetModelName) {
    return `${baseName} Copy`;
  }

  if (baseName.toLowerCase().includes(input.targetModelName.toLowerCase())) {
    return baseName;
  }

  return `${baseName} · ${input.targetModelName}`;
}

export function adaptPromptTextForTargetModel(input: {
  sourcePromptText?: string | null;
  sourceModelName?: string | null;
  targetModelName: string;
  fallbackPromptText: string;
}): string {
  const sourcePrompt = input.sourcePromptText?.trim();
  if (!sourcePrompt) {
    return input.fallbackPromptText;
  }

  if (!input.sourceModelName || input.sourceModelName === input.targetModelName) {
    return sourcePrompt;
  }

  const matcher = new RegExp(escapeRegExp(input.sourceModelName), "gi");
  if (!matcher.test(sourcePrompt)) {
    return sourcePrompt;
  }

  return sourcePrompt.replace(matcher, input.targetModelName);
}
