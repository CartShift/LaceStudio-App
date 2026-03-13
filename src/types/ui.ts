export type FieldErrorMap = Record<string, string[]>;

export type DashboardSummaryResponse = {
  active_jobs: number;
  stale_jobs: number;
  campaigns_in_review: number;
  publishing_pending_approval: number;
  failed_publishing: number;
  models_total: number;
  campaigns_total: number;
};
