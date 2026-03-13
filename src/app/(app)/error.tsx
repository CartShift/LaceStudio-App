"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { EditorialCard } from "@/components/ui/editorial-card";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <EditorialCard>
      <h2 className="font-display text-xl font-semibold">This section ran into an issue</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {error.message || "Something unexpected happened while loading this section."}
      </p>
      <Button onClick={() => reset()} className="mt-4">
        Try Again
      </Button>
    </EditorialCard>
  );
}

