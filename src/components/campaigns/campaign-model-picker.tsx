"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/cn";

export type CampaignModelPickerItem = {
  id: string;
  name: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
};

type CampaignModelPickerProps = {
  models: CampaignModelPickerItem[];
  selectedModelIds: string[];
  onSelectedModelIdsChange: (nextIds: string[]) => void;
  currentModelId?: string;
  disabled?: boolean;
  error?: string;
  emptyMessage?: string;
};

export function CampaignModelPicker({
  models,
  selectedModelIds,
  onSelectedModelIdsChange,
  currentModelId,
  disabled = false,
  error,
  emptyMessage = "No active models are available.",
}: CampaignModelPickerProps) {
  function toggleModel(modelId: string) {
    if (disabled) return;

    if (selectedModelIds.includes(modelId)) {
      onSelectedModelIdsChange(selectedModelIds.filter(id => id !== modelId));
      return;
    }

    onSelectedModelIdsChange([...selectedModelIds, modelId]);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={selectedModelIds.length > 0 ? "success" : "warning"}>
            {selectedModelIds.length} selected
          </Badge>
          <p className="text-xs text-muted-foreground">
            One setup can spawn one linked draft per selected model.
          </p>
        </div>

        {models.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => onSelectedModelIdsChange(models.map(model => model.id))}
            >
              Select all
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled || selectedModelIds.length === 0}
              onClick={() => onSelectedModelIdsChange([])}
            >
              Clear
            </Button>
          </div>
        ) : null}
      </div>

      {models.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/70 bg-card/45 p-4 text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {models.map(model => {
            const selected = selectedModelIds.includes(model.id);

            return (
              <label
                key={model.id}
                htmlFor={`campaign-model-${model.id}`}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition-colors",
                  selected
                    ? "border-primary/55 bg-primary/7 shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary),transparent_65%)]"
                    : "border-border/70 bg-card/55 hover:border-border"
                )}
              >
                <Checkbox
                  id={`campaign-model-${model.id}`}
                  checked={selected}
                  disabled={disabled}
                  onCheckedChange={() => toggleModel(model.id)}
                  className="mt-0.5"
                />

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold">{model.name}</p>
                    {currentModelId === model.id ? <Badge tone="neutral">Current</Badge> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {currentModelId === model.id
                      ? "Reuse this setup on the current model too."
                      : "Create a linked draft with this model attached."}
                  </p>
                </div>
              </label>
            );
          })}
        </div>
      )}

      {error ? <p className="text-sm text-[var(--status-danger)]">{error}</p> : null}
    </div>
  );
}
