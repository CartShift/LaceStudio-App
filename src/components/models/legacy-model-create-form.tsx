"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StateBlock } from "@/components/ui/state-block";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/workspace/form-field";
import { FormShell } from "@/components/workspace/form-shell";
import { apiRequest } from "@/lib/client-api";

export function LegacyModelCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const result = await apiRequest<{ id: string }>("/api/models", {
        method: "POST",
        body: JSON.stringify({
          name,
          description,
        }),
      });

      router.push(`/models/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't create this Model. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormShell title="Model Profile" description="Create your Model profile for upcoming Campaigns.">
      <form className="space-y-4" onSubmit={onSubmit}>
        <FormField label="Name">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength={2}
            maxLength={50}
            required
          />
        </FormField>

        <FormField label="Description">
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={500}
            rows={4}
          />
        </FormField>

        {error ? <StateBlock tone="danger" title="Model creation issue" description={error} /> : null}

        <Button type="submit" disabled={saving}>
          {saving ? "Creating..." : "Create Model"}
        </Button>
      </form>
    </FormShell>
  );
}
