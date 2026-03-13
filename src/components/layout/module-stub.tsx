import { PageHeader } from "@/components/layout/page-header";
import { EditorialCard } from "@/components/ui/editorial-card";

export function ModuleStub({
  title,
  description,
  highlights,
}: {
  title: string;
  description: string;
  highlights: string[];
}) {
  return (
    <div className="space-y-4">
      <PageHeader title={title} description={description} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {highlights.map((item) => (
          <EditorialCard key={item}>
            <p className="text-sm text-muted-foreground">{item}</p>
          </EditorialCard>
        ))}
      </div>
    </div>
  );
}
