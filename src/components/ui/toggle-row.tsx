import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";

type ToggleRowProps = {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
  className?: string;
};

export function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  className,
}: ToggleRowProps) {
  return (
    <div
      className={cn(
        "ds-panel-muted flex items-center justify-between gap-3 rounded-xl px-3.5 py-3",
        className,
      )}
    >
      <div>
        <p className="text-sm font-medium leading-tight">{label}</p>
        {description ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      <Switch aria-label={label} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}
