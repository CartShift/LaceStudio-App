"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

const SIZE = 16;

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  const isDark = resolvedTheme === "dark";
  const icon = mounted ? (isDark ? <Sun size={SIZE} /> : <Moon size={SIZE} />) : <Sun size={SIZE} />;

  return (
    <Button
      variant="outline"
      size="icon-sm"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="rounded-full border-border/80 bg-[color:color-mix(in_oklab,var(--card),transparent_8%)] text-muted-foreground hover:text-foreground"
      aria-label="Toggle color mode"
      type="button"
    >
      {icon}
    </Button>
  );
}
