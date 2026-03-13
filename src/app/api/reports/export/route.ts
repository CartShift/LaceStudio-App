import { NextResponse } from "next/server";
import { assertRole, getSessionContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

export async function GET(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator", "client"]);

    if (isDemoMode()) {
      const rows = demoStore.listRevenueEntries();
      const header = "client,contract_id,type,amount_usd,reference_month";
      const lines = rows.map((row) => toCsvLine([
        row.contract?.client?.name ?? "Unknown",
        row.contract_id,
        row.type,
        Number(row.amount_usd),
        row.reference_month,
      ]));

      return new NextResponse([header, ...lines].join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename=LaceStudio-report-${new Date().toISOString().slice(0, 10)}.csv`,
        },
      });
    }

    const rows = await prisma.revenueEntry.findMany({
      include: {
        contract: {
          include: {
            client: true,
          },
        },
      },
      orderBy: { reference_month: "desc" },
      take: 500,
    });

    const header = "client,contract_id,type,amount_usd,reference_month";
    const lines = rows.map((row) => toCsvLine([
      row.contract.client.name,
      row.contract_id,
      row.type,
      Number(row.amount_usd),
      row.reference_month.toISOString(),
    ]));

    return new NextResponse([header, ...lines].join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=LaceStudio-report-${new Date().toISOString().slice(0, 10)}.csv`,
      },
    });
  });
}

function toCsvLine(values: Array<string | number | Date | null | undefined>): string {
  return values.map((value) => encodeCsvField(value)).join(",");
}

function encodeCsvField(value: string | number | Date | null | undefined): string {
  const text = value instanceof Date ? value.toISOString() : String(value ?? "");
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const hardened = normalizeSpreadsheetFormulaPrefix(normalized);
  const escaped = hardened.replace(/"/g, "\"\"");
  return `"${escaped}"`;
}

function normalizeSpreadsheetFormulaPrefix(value: string): string {
  if (!value) return value;

  const firstNonWhitespaceIndex = value.search(/\S/);
  if (firstNonWhitespaceIndex === -1) return value;

  const firstChar = value[firstNonWhitespaceIndex];
  if (firstChar === "=" || firstChar === "+" || firstChar === "-" || firstChar === "@") {
    return `${value.slice(0, firstNonWhitespaceIndex)}'${value.slice(firstNonWhitespaceIndex)}`;
  }

  return value;
}

