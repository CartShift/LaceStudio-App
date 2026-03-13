import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultCharacterDraft,
  createDefaultPersonalityDraft,
  createDefaultSocialTracksDraft,
} from "@/components/models/types";

const mocks = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
}));

vi.mock("@/lib/client-api", () => ({
  apiRequest: mocks.apiRequestMock,
}));

import { useModelWizardAutosave } from "@/components/models/use-model-wizard-autosave";

describe("useModelWizardAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.apiRequestMock.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves a scheduled draft after the debounce window", async () => {
    const onStepSaved = vi.fn();
    const { result } = renderHook(() =>
      useModelWizardAutosave({
        modelId: "model-1",
        activeStep: "character_design",
        payloadByStep: {
          character_design: createDefaultCharacterDraft(),
          personality: createDefaultPersonalityDraft(),
          social_strategy: createDefaultSocialTracksDraft(),
        },
        onStepSaved,
      }),
    );

    act(() => {
      result.current.scheduleAutosave(
        "character_design",
        createDefaultCharacterDraft(),
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(799);
    });
    expect(mocks.apiRequestMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(mocks.apiRequestMock).toHaveBeenCalledTimes(1);
    expect(mocks.apiRequestMock).toHaveBeenCalledWith(
      "/api/models/model-1/workflow",
      {
        method: "PATCH",
        body: JSON.stringify({
          step: "character_design",
          payload: createDefaultCharacterDraft(),
        }),
      },
    );
    expect(onStepSaved).toHaveBeenCalledTimes(1);
    expect(onStepSaved).toHaveBeenCalledWith(
      "character_design",
      expect.any(String),
    );
    expect(result.current.saveState).toBe("saved");
    expect(result.current.saveTimestamp).toEqual(expect.any(String));
  });

  it("cancels pending autosaves while hydration is suspended", async () => {
    const onStepSaved = vi.fn();
    const { result } = renderHook(() =>
      useModelWizardAutosave({
        modelId: "model-1",
        activeStep: "personality",
        payloadByStep: {
          character_design: createDefaultCharacterDraft(),
          personality: createDefaultPersonalityDraft(),
          social_strategy: createDefaultSocialTracksDraft(),
        },
        onStepSaved,
      }),
    );

    act(() => {
      result.current.scheduleAutosave(
        "personality",
        createDefaultPersonalityDraft(),
      );
      result.current.suspendAutosave();
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mocks.apiRequestMock).not.toHaveBeenCalled();
    expect(onStepSaved).not.toHaveBeenCalled();
  });

  it("ignores in-flight autosave completions after hydration is suspended", async () => {
    const onStepSaved = vi.fn();
    let resolveSave: (() => void) | null = null;
    mocks.apiRequestMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );

    const { result } = renderHook(() =>
      useModelWizardAutosave({
        modelId: "model-1",
        activeStep: "personality",
        payloadByStep: {
          character_design: createDefaultCharacterDraft(),
          personality: createDefaultPersonalityDraft(),
          social_strategy: createDefaultSocialTracksDraft(),
        },
        onStepSaved,
      }),
    );

    act(() => {
      result.current.scheduleAutosave(
        "personality",
        createDefaultPersonalityDraft(),
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(mocks.apiRequestMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.suspendAutosave();
    });

    await act(async () => {
      resolveSave?.();
      await Promise.resolve();
    });

    expect(onStepSaved).not.toHaveBeenCalled();
    expect(result.current.saveState).toBe("saving");
  });

  it("clears stale autosave errors when hydration syncs a saved timestamp", async () => {
    mocks.apiRequestMock.mockRejectedValueOnce(new Error("save failed"));

    const { result } = renderHook(() =>
      useModelWizardAutosave({
        modelId: "model-1",
        activeStep: "social_strategy",
        payloadByStep: {
          character_design: createDefaultCharacterDraft(),
          personality: createDefaultPersonalityDraft(),
          social_strategy: createDefaultSocialTracksDraft(),
        },
        onStepSaved: vi.fn(),
      }),
    );

    act(() => {
      result.current.scheduleAutosave(
        "social_strategy",
        createDefaultSocialTracksDraft(),
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(result.current.saveState).toBe("error");
    expect(result.current.saveError).toBe("save failed");

    act(() => {
      result.current.syncSaveTimestamp("2026-03-12T21:00:00.000Z");
    });

    expect(result.current.saveState).toBe("saved");
    expect(result.current.saveError).toBeNull();
    expect(result.current.saveTimestamp).toBe("2026-03-12T21:00:00.000Z");
  });
});
