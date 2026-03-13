"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SelectField } from "@/components/ui/select";
import { controlCompactClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/cn";
import type { AppRole } from "@/lib/auth";

const ROLE_USER_IDS: Record<AppRole, string> = {
  admin: "00000000-0000-0000-0000-000000000001",
  operator: "00000000-0000-0000-0000-000000000002",
  client: "00000000-0000-0000-0000-000000000003",
};

export function RoleSwitcher({ role }: { role: AppRole }) {
  const router = useRouter();
  const [value, setValue] = useState<AppRole>(role);

  function setCookie(name: string, cookieValue: string) {
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${name}=${encodeURIComponent(cookieValue)}; path=/; max-age=2592000; samesite=strict${secure}`;
  }

  function onRoleChange(nextRole: AppRole) {
    setValue(nextRole);
    setCookie("lacestudio-role", nextRole);
    setCookie("lacestudio-user-id", ROLE_USER_IDS[nextRole]);
    router.refresh();
  }

  return (
    <label className="ds-pill inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold text-muted-foreground">
      <span>Role</span>
      <SelectField
        className={cn(
          controlCompactClass,
          "h-7 min-w-[108px] border-transparent bg-transparent py-0 pr-8 text-xs shadow-none",
        )}
        value={value}
        onChange={(event) => onRoleChange(event.target.value as AppRole)}
      >
        <option value="admin">admin</option>
        <option value="operator">operator</option>
        <option value="client">client</option>
      </SelectField>
    </label>
  );
}

