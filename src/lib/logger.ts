export type LogLevel = "info" | "warn" | "error";

export type StructuredLog = {
  timestamp: string;
  level: LogLevel;
  service: "api" | "webhook" | "cron" | "gpu" | "ui";
  action: string;
  entity_type?: string;
  entity_id?: string;
  user_id?: string;
  duration_ms?: number;
  error?: string;
  metadata?: Record<string, unknown>;
};

export function log(entry: Omit<StructuredLog, "timestamp">): void {
  const payload: StructuredLog = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  if (payload.level === "error") {
    console.error(JSON.stringify(payload));
    return;
  }

  if (payload.level === "warn") {
    console.warn(JSON.stringify(payload));
    return;
  }

  console.log(JSON.stringify(payload));
}
