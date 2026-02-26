import * as XLSX from "xlsx";
import { PayrollEmployee, PayrollParseResult } from "../types";
import { toNumber } from "../utils";

function isBlankRow(r: any[]): boolean {
  return r.every((c) => c == null || String(c).trim() === "");
}

function findFirstDate(grid: any[][]): string | undefined {
  for (const row of grid) {
    for (const cell of row) {
      const s = String(cell ?? "");
      const m = s.match(/\b\d{2}\/\d{2}\/\d{4}\b/);
      if (m) return m[0];
    }
  }
  return undefined;
}

export function parsePayrollRegisterExcel(buf: Buffer): PayrollParseResult {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as any[][];
  const payDate = findFirstDate(grid);

  const employees: PayrollEmployee[] = [];
  let i = 0;

  // Parse repeating blocks:
  // Row containing employee name like "ANDREW WINIG  Default - #10"
  // Then a "Pay Type" header and rows until "Totals:"
  // Then sections "Deductions (ER)" etc
  while (i < grid.length) {
    const row = grid[i];
    const cell1 = String(row?.[1] ?? "").trim(); // employee name is in col 1 in sample
    const empId = String(row?.[11] ?? "").trim();

    const looksLikeEmpHeader =
      cell1 &&
      /default\s*-\s*#\d+/i.test(cell1) &&
      !/payroll register/i.test(cell1);

    if (!looksLikeEmpHeader) {
      i++;
      continue;
    }

    const name = cell1.replace(/\s+Default\s*-\s*#\d+\s*$/i, "").trim();
    const id = empId || cell1.match(/#(\d+)/)?.[1];

    // Advance to Pay Type header
    let j = i;
    while (j < grid.length && !String(grid[j]?.[1] ?? "").trim().toLowerCase().includes("pay type")) j++;
    if (j >= grid.length) { i++; continue; }

    j++; // first pay type row
    let salaryAmt = 0;
    let overtimeAmt = 0;
    let holAmt = 0;
    let holHours = 0;

    // In this report, current hours are in col 2, current amount in col 3
    for (; j < grid.length; j++) {
      const r = grid[j];
      const payType = String(r?.[1] ?? "").trim();
      const hours = toNumber(r?.[2]);
      const amt = toNumber(r?.[3]);
      if (!payType) continue;
      if (/^totals?:$/i.test(payType) || /^totals?:$/i.test(String(r?.[1] ?? ""))) break;

      if (/^overtime$/i.test(payType)) {
        overtimeAmt += amt;
      } else if (/^hol$/i.test(payType)) {
        holAmt += amt;
        holHours += hours;
      } else {
        // everything else counts toward Salary bucket (Salary/Regular/Auto Allowance/etc.)
        salaryAmt += amt;
      }
    }

    // Find ER 401k in Deductions (ER) section
    let k = j;
    while (k < grid.length && !String(grid[k]?.[1] ?? "").toLowerCase().includes("deductions (er)")) k++;
    let er401kAmt = 0;
    if (k < grid.length) {
      k++;
      for (; k < grid.length; k++) {
        const r = grid[k];
        const label = String(r?.[1] ?? "").trim();
        if (!label) continue;
        if (/^taxes/i.test(label)) break;
        const amt = toNumber(r?.[3]);
        if (/401k/i.test(label) && !/loan/i.test(label)) {
          er401kAmt += amt;
        }
      }
    }

    employees.push({ id, name, salaryAmt, overtimeAmt, holAmt, holHours, er401kAmt });

    i = k;
  }

  // Totals from report: sum employees (more reliable than trying to find Report Total rows)
  const reportTotals = employees.reduce(
    (acc, e) => {
      acc.salaryTotal += e.salaryAmt;
      acc.overtimeAmtTotal += e.overtimeAmt;
      acc.holAmtTotal += e.holAmt;
      acc.holHoursTotal += e.holHours;
      acc.er401kTotal += e.er401kAmt;
      return acc;
    },
    { salaryTotal: 0, overtimeAmtTotal: 0, overtimeHoursTotal: 0, holHoursTotal: 0, holAmtTotal: 0, er401kTotal: 0 }
  );

  return { payDate, reportTotals, employees };
}
