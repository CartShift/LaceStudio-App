import { Label } from "@/components/ui/label";

export function FieldLabel({
  children,
  htmlFor,
  required,
}: {
  children: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
}) {
  return (
    <Label htmlFor={htmlFor} className="mb-2 block">
      <span>{children}</span>
      {required ? <span className="ml-1 text-destructive">*</span> : null}
    </Label>
  );
}
