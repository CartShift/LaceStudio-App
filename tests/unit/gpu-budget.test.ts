import { describe, expect, it } from "vitest";
import {
  calculateBudgetUsagePercentage,
  estimateGpuCost,
  isBudgetExceeded,
  isBudgetWarning,
} from "@/server/services/gpu-budget";

describe("gpu-budget", () => {
  it("estimates cost", () => {
    expect(estimateGpuCost(1000, 0.0005)).toBe(0.5);
  });

  it("calculates usage and thresholds", () => {
    expect(calculateBudgetUsagePercentage(400, 500)).toBe(80);
    expect(isBudgetWarning(400, 500)).toBe(true);
    expect(isBudgetExceeded(500, 500)).toBe(true);
  });
});
