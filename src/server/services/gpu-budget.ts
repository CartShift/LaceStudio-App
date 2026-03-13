export function estimateGpuCost(totalGenerationTimeMs: number, ratePerMs: number): number {
  return Number((totalGenerationTimeMs * ratePerMs).toFixed(4));
}

export function calculateBudgetUsagePercentage(spend: number, cap: number): number {
  if (cap <= 0) return 0;
  return Number(((spend / cap) * 100).toFixed(2));
}

export function isBudgetExceeded(spend: number, cap: number): boolean {
  return calculateBudgetUsagePercentage(spend, cap) >= 100;
}

export function isBudgetWarning(spend: number, cap: number): boolean {
  const usage = calculateBudgetUsagePercentage(spend, cap);
  return usage >= 80 && usage < 100;
}
