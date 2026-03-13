import { EditorialCard } from "@/components/ui/editorial-card";
import { Skeleton } from "@/components/ui/skeleton";

export default function AppLoading() {
  return (
    <div className="space-y-4">
      <EditorialCard>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-4 w-72" />
      </EditorialCard>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <EditorialCard key={index}>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-6 w-2/3" />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-2 h-10 w-32" />
          </EditorialCard>
        ))}
      </div>
    </div>
  );
}
