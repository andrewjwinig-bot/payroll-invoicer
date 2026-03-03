import { NextResponse } from "next/server";

import { parseAllocationWorkbook } from "../../../lib/allocation/parseAllocationWorkbook";
import { parsePayrollRegisterExcel } from "../../../lib/payroll/parsePayrollRegisterExcel";
import { buildInvoices } from "../../../lib/invoicing/buildInvoices";
import type { AllocationEmployee, PayrollParseResult } from "../../../lib/types";

/**
 * POST /api/parse-payroll
 *
 * Body: { fileBase64: string, filename?: string }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const fileBase64 = body?.fileBase64 as string | undefined;
    const filename = (body?.filename as string | undefined) ?? "payroll.xlsx";

    if (!fileBase64) {
      return NextResponse.json({ error: "Missing fileBase64" }, { status: 400 });
    }

    const payroll: PayrollParseResult = await parsePayrollRegisterExcel(fileBase64, filename);
    const allocation = await parseAllocationWorkbook();

    // Merge allocation rows with parsed payroll employees. Prefer employeeId match (if present),
    // fall back to case-insensitive name containment.
    const payrollEmployees = payroll?.employees ?? [];
    const mergedEmployees: AllocationEmployee[] = (allocation?.employees ?? []).map((ae: any) => {
      const aId = ae.employeeId ?? ae.id ?? null;

      const pe =
        payrollEmployees.find((p: any) => aId != null && String(p.employeeId ?? "").trim() === String(aId).trim()) ??
        payrollEmployees.find((p: any) => {
          const pn = String(p.name ?? "").toLowerCase();
          const an = String(ae.name ?? "").toLowerCase();
          return pn && an && (pn.includes(an) || an.includes(pn));
        }) ??
        null;

      return {
        ...ae,
        employeeId: aId ?? pe?.employeeId ?? ae.employeeId,
        payrollName: pe?.name ?? null,
        salaryAmt: pe?.salaryAmt ?? 0,
        overtimeAmt: pe?.overtimeAmt ?? 0,
        overtimeHours: pe?.overtimeHours ?? 0,
        holAmt: pe?.holAmt ?? 0,
        holHours: pe?.holHours ?? 0,
        er401kAmt: pe?.er401kAmt ?? 0,
        // normalize allocations shape for downstream
        allocations: ae.allocations ?? ae.top ?? {},
      };
    });

    const invoices = buildInvoices(mergedEmployees as any, allocation?.properties ?? []);

    return NextResponse.json({
      payDate: payroll?.payDate ?? null,
      payrollTotals: payroll?.totals ?? null,
      employees: mergedEmployees,
      invoices,
      properties: allocation?.properties ?? [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
