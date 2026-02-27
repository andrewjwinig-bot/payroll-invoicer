import * as XLSX from "xlsx";
import { PayrollEmployee, PayrollParseResult } from "../types";
import { toNumber } from "../utils";

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

function cleanName(s: string) {
  return (s || "").replace(/\s+Default\s*-\s*#\d+\s*$/i, "").trim();
}

function isOvertimeLabel(label: string) {
  const s = label.toLowerCase().trim();
  return s === "overtime" || s.startsWith("overtime") || /^ot\b/.test(s) || s.includes("over time");
}

function isHolLabel(label: string) {
  const s = label.toLowerCase().trim();
  return s === "hol" || s.startsWith("hol") || s.includes("holiday");
}

export function parsePayrollRegisterExcel(buf: Buffer): PayrollParseResult {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as any[][];

  const payDate = findFirstDate(grid);

  const employees: PayrollEmployee[] = [];
  let i = 0;

  while (i < grid.length) {
    const row = grid[i];
    const cellB = String(row?.[1] ?? "").trim();

    const looksLikeEmpHeader =
      cellB &&
      (/default\s*-\s*#\d+/i.test(cellB) || (/^[A-Z][A-Z\s\-']+$/.test(cellB) && cellB.length >= 6)) &&
      !/payroll register/i.test(cellB);

    if (!looksLikeEmpHeader) {
      i++;
      continue;
    }

    const name = cleanName(cellB);

    // Advance to Pay Type header
    let j = i;
    while (j < grid.length && !String(grid[j]?.[1] ?? "").trim().toLowerCase().includes("pay type")) j++;
    if (j >= grid.length) {
      i++;
      continue;
    }

    j++; // first pay type row
    let salaryAmt = 0;
    let overtimeAmt = 0;
    let overtimeHours = 0;
    let holAmt = 0;
    let holHours = 0;

    // Pay type label in col B, hours in col C, amount in col D
    for (; j < grid.length; j++) {
      const r = grid[j];
      const label = String(r?.[1] ?? "").trim();
      const hours = toNumber(r?.[2]);
      const amt = toNumber(r?.[3]);

      if (!label) continue;
      if (/^totals?:\s*$/i.test(label)) break;

      if (isOvertimeLabel(label)) {
        overtimeAmt += amt;
        overtimeHours += hours;
      } else if (isHolLabel(label)) {
        holAmt += amt;
        holHours += hours;
      } else {
        salaryAmt += amt;
      }
    }

    // Find ER 401k in Deductions (ER) section
    let k = j;
    while (k < grid.length && !String(grid[k]?.[1] ?? "").toLowerCase().includes("deductions (er)")) k++;
    let er401k = 0;
    if (k < grid.length) {
      k++;
      for (; k < grid.length; k++) {
        const r = grid[k];
        const label = String(r?.[1] ?? "").trim();
        if (!label) continue;
        if (/^taxes/i.test(label)) break;
        const amt = toNumber(r?.[3]);
        // Only employer 401k (ER)
        if (/401k/i.test(label) && /er/i.test(label) && !/loan/i.test(label)) {
          er401k += amt;
        }
      }
    }

    employees.push({
      name,
      salaryAmt,
      overtimeAmt,
      overtimeHours,
      holAmt,
      holHours,
      er401k,
    });

    i = k;
  }

  const reportTotals = employees.reduce(
    (acc, e) => {
      acc.salaryTotal += e.salaryAmt;
      acc.overtimeAmtTotal += e.overtimeAmt;
      acc.overtimeHoursTotal += e.overtimeHours ?? 0;
      acc.holAmtTotal += e.holAmt;
      acc.holHoursTotal += e.holHours ?? 0;
      acc.er401kTotal += e.er401k;
      return acc;
    },
    {
      salaryTotal: 0,
      overtimeAmtTotal: 0,
      overtimeHoursTotal: 0,
      holHoursTotal: 0,
      holAmtTotal: 0,
      er401kTotal: 0,
    }
  );

  return { payDate, reportTotals, employees };
}
