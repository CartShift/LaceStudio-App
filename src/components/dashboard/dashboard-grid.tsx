import { StatCard } from "@/components/ui/stat-card";

export function DashboardGrid() {
  const kpis = [
    { label: "Models Active", value: "1", tone: "success" as const },
    { label: "Campaign Cycle", value: "18m", tone: "neutral" as const },
    { label: "GPU Budget", value: "34%", tone: "warning" as const },
    { label: "Posts / Week", value: "4", tone: "success" as const },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {kpis.map((item) => (
        <StatCard key={item.label} label={item.label} value={item.value} tone={item.tone} />
      ))}
    </div>
  );
}
