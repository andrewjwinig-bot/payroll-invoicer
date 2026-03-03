import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

import { buildInvoices } from "@/lib/invoicing/buildInvoices";
import { parseAllocationWorkbook } from "@/lib/allocation/parseAllocationWorkbook";
import { parsePayrollRegisterExcel } from "@/lib/payroll/parsePayrollRegisterExcel";
import type { AllocationEmployee, PayrollEmployee } from "@/lib/types";

/**
 * POST /api/parse-payroll
 * Body: { payrollBase64: string } where the string is a DataURL or raw base64.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const payrollBase64: string | undefined = body?.payrollBase64;

    if (!payrollBase64 || typeof payrollBase64 !== "string") {
      return NextResponse.json({ error: "Missing payrollBase64" }, { status: 400 });
    }

    // Accept either "data:...;base64,XXXX" or raw base64
    const b64 = payrollBase64.includes("base64,")
      ? payrollBase64.split("base64,")[1]
      : payrollBase64;

    const payrollBuf = Buffer.from(b64, "base64");

    const payroll = parsePayrollRegisterExcel(payrollBuf); // { payDate?, employees: [...] }
    const payrollEmployees = payroll.employees;

    // Allocation workbook is fixed on the backend
    const allocPath = path.join(process.cwd(), "data", "allocation.xlsx");
    const allocBuf = fs.readFileSync(allocPath);
    const allocation = parseAllocationWorkbook(allocBuf);

    // Merge allocation employees with payroll employees
    const mergedEmployees = allocation.employees.map((ae: AllocationEmployee) => {
      const pe: PayrollEmployee | undefined =
        (ae.employeeId != null
          ? payrollEmployees.find((p) => String(p.employeeId ?? "") === String(ae.employeeId ?? ""))
          : undefined) ??
        (ae.employeeKey
          ? payrollEmployees.find((p) =>
              (p.employeeKey ?? "").toLowerCase() === (ae.employeeKey ?? "").toLowerCase()
            )
          : undefined) ??
        (ae.name
          ? payrollEmployees.find((p) =>
              (p.name ?? "").toLowerCase().includes((ae.name ?? "").toLowerCase())
            )
          : undefined);

      return {
        employeeId: ae.employeeId ?? null,
        employeeKey: ae.employeeKey ?? null,
        name: ae.name,
        recoverable: ae.recoverable,
        allocations: ae.allocations ?? ae.allocationTable ?? {},
        payrollName: pe?.name ?? null,
        salaryAmt: pe?.salaryAmt ?? 0,
        overtimeAmt: pe?.overtimeAmt ?? 0,
        overtimeHours: pe?.overtimeHours ?? 0,
        holAmt: pe?.holAmt ?? 0,
        holHours: pe?.holHours ?? 0,
        er401kAmt: pe?.er401kAmt ?? 0,
      };
    });

    const invoices = buildInvoices({
      allocation,
      payroll,
      mergedEmployees,
    });

    return NextResponse.json({
      payDate: payroll.payDate ?? null,
      allocation,
      payroll,
      employees: mergedEmployees,
      invoices,
    });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
