import { formatISO } from "date-fns";

export function nowIso(): string {
  return formatISO(new Date());
}

export function toNumber(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp(
  value: number,
  min: number,
  max: number,
  options?: { round?: boolean; precision?: number },
): number {
  const fallback = Number.isFinite(value) ? value : min;
  let bounded = Math.min(Math.max(fallback, min), max);

  if (options?.round) {
    bounded = Math.round(bounded);
  }

  if (typeof options?.precision === "number" && Number.isInteger(options.precision) && options.precision >= 0) {
    const factor = 10 ** options.precision;
    bounded = Math.round(bounded * factor) / factor;
  }

  return bounded;
}

export function clampInt(value: string | number, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max, { round: true });
}

export function clampFloat(
  value: string | number,
  fallback: number,
  min: number,
  max: number,
  precision = 2,
): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max, { precision });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
