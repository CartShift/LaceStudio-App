"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { StateBlock } from "@/components/ui/state-block";
import { SquareImageThumbnail } from "@/components/ui/square-image-thumbnail";
import { EditorialCard } from "@/components/ui/editorial-card";
import { humanizeStatusLabel } from "@/lib/status-labels";
import type { CanonicalPackSummary } from "@/components/models/types";
import type { ImageModelProvider } from "@/server/schemas/creative";

const FRONT_SHOT_CODE = "frontal_closeup";

export function StepReferenceStudio({
  canonicalPackStatus,
  summary,
  provider,
  providerModelId,
  candidatesPerShot,
  generating,
  approvingFront,
  onProviderChange,
  onProviderModelIdChange,
  onCandidatesPerShotChange,
  onGenerateFront,
  onGenerateRemaining,
  onApproveFront,
  selectedByShot,
  onSelectCandidate,
}: {
  canonicalPackStatus: "NOT_STARTED" | "GENERATING" | "READY" | "APPROVED" | "FAILED";
  summary: CanonicalPackSummary | null;
  provider: ImageModelProvider;
  providerModelId: string;
  candidatesPerShot: number;
  generating: boolean;
  approvingFront: boolean;
  onProviderChange: (provider: ImageModelProvider) => void;
  onProviderModelIdChange: (modelId: string) => void;
  onCandidatesPerShotChange: (count: number) => void;
  onGenerateFront: () => Promise<void>;
  onGenerateRemaining: () => Promise<void>;
  onApproveFront: () => Promise<void>;
  selectedByShot: Record<string, string>;
  onSelectCandidate: (shotCode: string, candidateId: string) => void;
}) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const previewCandidates = useMemo(
    () =>
      (summary?.shots ?? []).flatMap((shot) =>
        shot.candidates
          .map((candidate) => {
            const uri = resolveCandidatePreviewUri(candidate);
            if (!uri) return null;
            return {
              id: candidate.id,
              uri,
              shotCode: shot.shot_code,
              candidateIndex: candidate.candidate_index,
              score: Number(candidate.composite_score ?? 0),
            };
          })
          .flatMap((item) => (item ? [item] : [])),
      ),
    [summary],
  );
  const activePreview = typeof previewIndex === "number" ? previewCandidates[previewIndex] : null;
  const candidateGroups = useMemo(() => {
    if (!summary) return [];
    const indices = new Set<number>();
    for (const shot of summary.shots) {
      for (const candidate of shot.candidates) {
        indices.add(candidate.candidate_index);
      }
    }

    return Array.from(indices)
      .sort((a, b) => a - b)
      .map((candidateIndex) => ({
        candidateIndex,
        types: summary.shots.map((shot) => {
          const candidate = shot.candidates.find((item) => item.candidate_index === candidateIndex);
          return {
            shotCode: shot.shot_code,
            candidate,
            isRecommended: candidate ? shot.recommended_candidate_id === candidate.id : false,
          };
        }),
      }));
  }, [summary]);
  const candidateNumbers = useMemo(
    () => Array.from(new Set(previewCandidates.map((item) => item.candidateIndex))).sort((a, b) => a - b),
    [previewCandidates],
  );
  const activeCandidateNumber = activePreview?.candidateIndex ?? (candidateNumbers[0] ?? null);
  const activeCandidateItems = useMemo(
    () => (activeCandidateNumber == null ? [] : previewCandidates.filter((item) => item.candidateIndex === activeCandidateNumber)),
    [activeCandidateNumber, previewCandidates],
  );
  const activeTypeShotCodes = useMemo(
    () => Array.from(new Set(activeCandidateItems.map((item) => item.shotCode))),
    [activeCandidateItems],
  );
  const activeShotCode = activePreview?.shotCode ?? (activeTypeShotCodes[0] ?? null);
  const activeCandidatePosition = activeCandidateNumber == null ? -1 : candidateNumbers.indexOf(activeCandidateNumber);
  const activeShotPosition = activeShotCode == null ? -1 : activeTypeShotCodes.indexOf(activeShotCode);
  const totalShotTypes = candidateGroups[0]?.types.length ?? (summary?.shots.length ?? 0);
  const canGoPrevCandidate = activeCandidatePosition > 0;
  const canGoNextCandidate = activeCandidatePosition >= 0 && activeCandidatePosition < candidateNumbers.length - 1;
  const canGoPrevType = activeShotPosition > 0;
  const canGoNextType = activeShotPosition >= 0 && activeShotPosition < activeTypeShotCodes.length - 1;
  const frontShot = summary?.shots.find((shot) => shot.shot_code === FRONT_SHOT_CODE);
  const hasFrontCandidates = (frontShot?.candidates.length ?? 0) > 0;
  const frontApproved = (frontShot?.candidates ?? []).some((candidate) => candidate.status === "SELECTED");
  const selectedFrontCandidateId = selectedByShot[FRONT_SHOT_CODE] ?? frontShot?.recommended_candidate_id ?? "";
  const hasRemainingCandidates = (summary?.shots ?? []).some(
    (shot) => shot.shot_code !== FRONT_SHOT_CODE && shot.candidates.length > 0,
  );
  const canApproveFront = hasFrontCandidates && !frontApproved && selectedFrontCandidateId.length > 0 && !approvingFront && !generating;
  const canGenerateRemaining = frontApproved && summary?.status === "READY" && !generating;
  const frontButtonLabel = hasFrontCandidates ? "Regenerate Front Look" : "Generate Front Look";
  const setPreviewByCandidateAndType = (candidateNumber: number, shotCode?: string) => {
    const pool = previewCandidates.filter((item) => item.candidateIndex === candidateNumber);
    if (pool.length === 0) return;
    const first = pool[0];
    if (!first) return;
    const target = shotCode ? pool.find((item) => item.shotCode === shotCode) ?? first : first;
    const idx = previewCandidates.findIndex((item) => item.id === target.id);
    if (idx >= 0) {
      setPreviewIndex(idx);
    }
  };

  return (
    <EditorialCard className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl">Reference Studio</h2>
          <p className="text-sm text-muted-foreground">
            Create and choose the best looks for your 8-angle Reference Set.
          </p>
        </div>
        <Badge tone={toneForPackStatus(canonicalPackStatus)}>{humanizeStatusLabel(canonicalPackStatus)}</Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <p className="mb-1 text-xs font-subheader">Image Engine</p>
          <SelectField
            value={provider}
            onChange={(event) => onProviderChange(event.target.value as ImageModelProvider)}
            disabled={generating}
          >
            <option value="openai">OpenAI</option>
            <option value="nano_banana_2">Nano Banana 2</option>
            <option value="zai_glm">Z.AI GLM</option>
            <option value="gpu">GPU</option>
          </SelectField>
        </div>
        <div>
          <p className="mb-1 text-xs font-subheader">Engine Version</p>
          <Input value={providerModelId} onChange={(event) => onProviderModelIdChange(event.target.value)} />
        </div>
        <div>
          <p className="mb-1 text-xs font-subheader">Options per Angle</p>
          <Input
            type="number"
            min={1}
            max={5}
            value={String(candidatesPerShot)}
            onChange={(event) => onCandidatesPerShotChange(Number(event.target.value || 1))}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => void onGenerateFront()} disabled={generating}>
          {generating ? "Generating..." : frontButtonLabel}
        </Button>
        {hasFrontCandidates && !frontApproved ? (
          <Button type="button" variant="secondary" onClick={() => void onApproveFront()} disabled={!canApproveFront}>
            {approvingFront ? "Approving Front..." : "Approve Front Look"}
          </Button>
        ) : null}
        {frontApproved && summary?.status === "READY" ? (
          <Button type="button" variant="secondary" onClick={() => void onGenerateRemaining()} disabled={!canGenerateRemaining}>
            {generating ? "Generating..." : hasRemainingCandidates ? "Regenerate Remaining Looks" : "Generate Remaining Looks"}
          </Button>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Approve one front look first, then create the remaining angles. This page updates as each look is ready.
        </p>
      </div>

      {summary?.progress ? (
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">{`${summary.progress.completed_shots}/${summary.progress.total_shots} angles ready · ${summary.progress.generated_candidates} options`}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted/60">
            <div
              className="h-full rounded-full bg-[var(--color-primary)] transition-all duration-500"
              style={{ width: `${Math.max(6, Math.min(100, (summary.progress.completed_shots / Math.max(summary.progress.total_shots, 1)) * 100))}%` }}
            />
          </div>
        </div>
      ) : null}

      {summary?.shots.length ? (
        <div className="space-y-4">
          {candidateGroups.map((group) => (
            <section key={`candidate-group-${group.candidateIndex}`} className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">{`Option ${group.candidateIndex}`}</h3>
                <Badge tone="neutral">{`${group.types.filter((item) => Boolean(item.candidate)).length}/${group.types.length} angles`}</Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                {group.types.map((typeItem) => {
                  const candidate = typeItem.candidate;
                  if (!candidate) {
                    return (
                      <div key={`${group.candidateIndex}-${typeItem.shotCode}`} className="rounded-2xl border border-dashed border-border bg-card p-3 text-[11px] text-muted-foreground">
                        <p className="font-medium">{typeItem.shotCode.replaceAll("_", " ")}</p>
                        <p className="mt-1">{summary.status === "GENERATING" ? "This angle is still being created..." : "No image for this angle."}</p>
                      </div>
                    );
                  }

                  const selected = selectedByShot[typeItem.shotCode] === candidate.id;
                  const previewUri = resolveCandidatePreviewUri(candidate);
                  const score = Number(candidate.composite_score ?? 0);

                  return (
                    <button
                      key={candidate.id}
                      type="button"
            className={`rounded-2xl border p-3 text-left transition ${
                        selected
                          ? "border-[var(--color-primary)] bg-[color:color-mix(in_oklab,var(--color-primary),transparent_88%)]"
                          : "border-border bg-card hover:border-[var(--color-primary)]"
                      }`}
                      onClick={() => onSelectCandidate(typeItem.shotCode, candidate.id)}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-subheader">{typeItem.shotCode.replaceAll("_", " ")}</p>
                        {typeItem.isRecommended ? <Badge tone="success">Recommended</Badge> : null}
                      </div>

                      <SquareImageThumbnail
                        src={previewUri}
                        alt={`Option ${candidate.candidate_index} ${typeItem.shotCode}`}
                        placeholder="Preview unavailable"
                        containerClassName="mb-2 rounded-xl"
                        expandButton={{
                          "aria-label": "Expand image",
                          onExpand: () => {
                            const idx = previewCandidates.findIndex((item) => item.id === candidate.id);
                            if (idx >= 0) setPreviewIndex(idx);
                          }
                        }}
                      />

                      <div className="grid gap-1 text-xs">
                        <p>{`Overall score: ${score.toFixed(3)}`}</p>
                        <p>{`Natural look: ${Number(candidate.realism_score ?? 0).toFixed(3)}`}</p>
                        <p>{`Sharpness: ${Number(candidate.clarity_score ?? 0).toFixed(3)}`}</p>
                        <p>{`Style match: ${Number(candidate.consistency_score ?? 0).toFixed(3)}`}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <StateBlock
          title="No Reference Set Yet"
          description="Create your first Reference Set to start choosing your favorite looks."
        />
      )}

      {activePreview ? (
        <div className="fixed inset-0 z-50 bg-background/85 p-3 backdrop-blur-sm sm:p-4" onClick={() => setPreviewIndex(null)}>
          <div
            className="mx-auto flex h-full w-full max-w-[1600px] flex-col overflow-hidden rounded-3xl border border-border/70 bg-card text-foreground shadow-[var(--shadow-lift)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 p-3 sm:p-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Expanded Preview</p>
                <p className="text-sm font-semibold">{`${activePreview.shotCode.replaceAll("_", " ")} · Option #${activePreview.candidateIndex}`}</p>
                <p className="text-xs text-muted-foreground">{`Score ${activePreview.score.toFixed(3)} · ${activeCandidateItems.length}/${totalShotTypes} angles ready`}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="rounded-full border border-border/80 bg-muted/60 px-2.5 py-1 text-[11px] text-muted-foreground">
                  {`Option ${Math.max(activeCandidatePosition + 1, 1)}/${Math.max(candidateNumbers.length, 1)}`}
                </p>
                <Button type="button" size="sm" variant="secondary" onClick={() => setPreviewIndex(null)}>
                  Close
                </Button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 gap-3 p-3 sm:gap-4 sm:p-4 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="relative min-h-[46vh] min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-muted/60 lg:min-h-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={activePreview.uri} alt={`Expanded option ${activePreview.candidateIndex}`} className="h-full w-full object-contain p-1.5 sm:p-2.5 lg:p-3" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/90 via-background/60 to-transparent p-3 sm:p-4">
                  <div className="flex items-end justify-between gap-2">
                    <p className="text-sm font-medium">{activePreview.shotCode.replaceAll("_", " ")}</p>
                    <p className="text-[11px] text-muted-foreground">{`Type ${Math.max(activeShotPosition + 1, 1)}/${Math.max(activeTypeShotCodes.length, 1)}`}</p>
                  </div>
                </div>
              </div>

              <aside className="flex min-h-0 flex-col gap-3 rounded-2xl border border-border/70 bg-muted/45 p-2.5 sm:p-3">
                <section className="rounded-xl border border-border/70 bg-muted/30 p-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Options</p>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          if (!canGoPrevCandidate || activeCandidateNumber == null) return;
                          setPreviewByCandidateAndType(candidateNumbers[activeCandidatePosition - 1] ?? activeCandidateNumber, activeShotCode ?? undefined);
                        }}
                        disabled={!canGoPrevCandidate}
                      >
                        Prev
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          if (!canGoNextCandidate || activeCandidateNumber == null) return;
                          setPreviewByCandidateAndType(candidateNumbers[activeCandidatePosition + 1] ?? activeCandidateNumber, activeShotCode ?? undefined);
                        }}
                        disabled={!canGoNextCandidate}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                  <div className="grid max-h-[26vh] gap-2 overflow-y-auto pr-1">
                    {candidateNumbers.map((candidateNumber) => {
                      const group = candidateGroups.find((item) => item.candidateIndex === candidateNumber);
                      const readyTypes = group ? group.types.filter((item) => Boolean(item.candidate)).length : 0;
                      const isActive = candidateNumber === activeCandidateNumber;
                      return (
                        <button
                          key={`candidate-modal-${candidateNumber}`}
                          type="button"
                          className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                            isActive
                              ? "border-primary/70 bg-primary/20 text-primary-foreground"
                              : "border-border/70 bg-muted/45 text-muted-foreground hover:border-primary/30 hover:bg-muted/60"
                          }`}
                          onClick={() => setPreviewByCandidateAndType(candidateNumber, activeShotCode ?? undefined)}
                        >
                          <p className="text-xs font-semibold">{`Option #${candidateNumber}`}</p>
                        <p className="text-[11px] text-muted-foreground">{`${readyTypes}/${totalShotTypes} angles ready`}</p>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-border/70 bg-muted/35 p-2.5">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium text-foreground/85">{`Angles for Option #${activeCandidateNumber ?? "-"}`}</p>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          if (!canGoPrevType || activeCandidateNumber == null) return;
                          const prevShotCode = activeTypeShotCodes[activeShotPosition - 1];
                          if (!prevShotCode) return;
                          setPreviewByCandidateAndType(activeCandidateNumber, prevShotCode);
                        }}
                        disabled={!canGoPrevType}
                      >
                        Prev Type
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          if (!canGoNextType || activeCandidateNumber == null) return;
                          const nextShotCode = activeTypeShotCodes[activeShotPosition + 1];
                          if (!nextShotCode) return;
                          setPreviewByCandidateAndType(activeCandidateNumber, nextShotCode);
                        }}
                        disabled={!canGoNextType}
                      >
                        Next Type
                      </Button>
                    </div>
                  </div>
                  <div className="grid min-h-0 flex-1 auto-rows-max gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
                    {activeCandidateItems.map((item) => {
                      const isActive = item.shotCode === activeShotCode;
                      return (
                        <button
                          key={`type-modal-${item.id}`}
                          type="button"
                          className={`rounded-xl border p-1.5 text-left transition ${
                            isActive
                              ? "border-primary/75 bg-primary/20 text-primary-foreground"
                              : "border-border/70 bg-muted/45 hover:border-primary/35 hover:bg-muted/60"
                          }`}
                          onClick={() => {
                            if (activeCandidateNumber == null) return;
                            setPreviewByCandidateAndType(activeCandidateNumber, item.shotCode);
                          }}
                        >
                          <div className="h-20 overflow-hidden rounded-lg border border-border/70 bg-muted/70">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={item.uri} alt={`Option ${item.candidateIndex} ${item.shotCode}`} className="h-full w-full object-contain p-1" />
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2 px-1">
                            <p className="truncate text-[11px] text-foreground/85">{item.shotCode.replaceAll("_", " ")}</p>
                            <p className="text-[10px] text-muted-foreground">{item.score.toFixed(3)}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </aside>
            </div>
          </div>
        </div>
      ) : null}
    </EditorialCard>
  );
}

function toneForPackStatus(
  status: "NOT_STARTED" | "GENERATING" | "READY" | "APPROVED" | "FAILED",
): "neutral" | "warning" | "success" | "danger" {
  if (status === "APPROVED") return "success";
  if (status === "FAILED") return "danger";
  if (status === "READY") return "warning";
  return "neutral";
}

function resolveCandidatePreviewUri(candidate: { image_gcs_uri: string; preview_image_url?: string | null }): string | null {
  const preview = candidate.preview_image_url?.trim();
  if (preview) return preview;

  const source = candidate.image_gcs_uri?.trim();
  if (!source) return null;

  if (source.startsWith("data:image/")) return source;
  if (source.startsWith("http://") || source.startsWith("https://")) return source;
  return null;
}

