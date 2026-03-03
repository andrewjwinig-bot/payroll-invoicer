import { NextResponse } from "next/server";
import { z } from "zod";
import { parsePayrollRegisterExcel } from "../../../lib/payroll/parsePayrollRegisterExcel";
import { parseAllocationWorkbook } from "../../../lib/allocation/parseAllocationWorkbook";
import { buildInvoices } from "../../../lib/invoicing/buildInvoices";
import { readFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

const BodySchema = z.object({
  fileBase64: z.string(),
  filename: z.string().optional(),
});

function stripSuffix(name: string) {
  return (name || "")
    .replace(/\bdefault\b.*$/i, "")
    .replace(/-\s*#\d+\s*$/i, "")
    .replace(/#\d+\s*$/i, "")
    .trim();
}

function normName(s: string) {
  return stripSuffix(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Canonical key "last|first" using letters only
function keyFromName(raw: string): string {
  const cleaned = stripSuffix(raw);
  const parts = cleaned.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (parts.length < 2) return "";
  const first = parts[0];
  const last = parts[parts.length - 1];
  return `${last}|${first}`;
}

function normalizeKey(k: string) {
  const parts = (k || "").toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]}|${parts[1]}`;
  return (k || "").toLowerCase().trim();
}

function lastName(s: string) {
  const n = normName(s);
  const parts = n.split(" ").filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/[a-z]/i.test(parts[i])) return parts[i];
  }
  return parts.length ? parts[parts.length - 1] : n;
}

function firstInitial(s: string) {
  const n = normName(s);
  const parts = n.split(" ").filter(Boolean);
  for (const p of parts) {
    if (/[a-z]/i.test(p)) return p[0];
  }
  return n ? n[0] : "";
}

export async function POST(req: Request) {
  try {
    const body = BodySchema.parse(await req.json());
    const buf = Buffer.from(body.fileBase64, "base64");
    const payroll = parsePayrollRegisterExcel(buf);

    const allocationPath = path.join(process.cwd(), "data", "allocation.xlsx");
    const allocBuf = await readFile(allocationPath);
    const allocation = parseAllocationWorkbook(allocBuf);

    const invoices = buildInvoices(payroll as any, allocation as any);

    // Employee summary list driven by allocation workbook so EVERY allocation row appears.
    const payrollByFull = new Map<string, any>();
    const payrollByLast = new Map<string, any[]>();
    const payrollByKey = new Map<string, any>();

    for (const pe of (payroll as any).employees ?? []) {
      const f = normName(pe.name);
      const l = lastName(pe.name);
      const k = normalizeKey(keyFromName(pe.name));
      if (k) payrollByKey.set(k, pe);
      payrollByFull.set(f, pe);
      const arr = payrollByLast.get(l) ?? [];
      arr.push(pe);
      payrollByLast.set(l, arr);
    }

    function findPayroll(ae: any) {
      // 1) Prefer EmployeeKey if present in allocation workbook
      const ak = ae?.employeeKey ? normalizeKey(ae.employeeKey) : "";
      if (ak) {
        const hit = payrollByKey.get(ak);
        if (hit) return hit;
      }

      // 2) fallback to name-based matching
      const f = normName(ae?.name);
      const direct = payrollByFull.get(f);
      if (direct) return direct;

      const l = lastName(ae?.name);
      const candidates = payrollByLast.get(l) ?? [];
      if (candidates.length === 1) return candidates[0];

      const fi = firstInitial(ae?.name);
      const match = candidates.find((c) => firstInitial(c.name) === fi);
      if (match) return match;

      return candidates[0];
    }

    const employees = (allocation.employees ?? []).map((ae) => {
      const pe = findPayroll(ae);
      return {
        name: ae.name,
        employeeKey: ae.employeeKey ?? null,
        recoverable: !!ae.recoverable,
        allocations: ae.allocations ?? {},
        payrollName: pe?.name ?? null,
        salaryAmt: pe?.salaryAmt ?? 0,
        overtimeAmt: pe?.overtimeAmt ?? 0,
        overtimeHours: pe?.overtimeHours ?? 0,
        holAmt: pe?.holAmt ?? 0,
        holHours: pe?.holHours ?? 0,
        er401k: pe?.er401k ?? 0,
        total:
          (pe?.salaryAmt ?? 0) +
          (pe?.overtimeAmt ?? 0) +
          (pe?.holAmt ?? 0) +
          (pe?.er401k ?? 0),
      };
    });

    return NextResponse.json({
      payroll,
      invoices,
      employees,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Failed to parse payroll file" },
      { status: 400 }
    );
  }
}
