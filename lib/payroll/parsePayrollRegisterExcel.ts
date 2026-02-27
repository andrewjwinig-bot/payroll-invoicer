import * as XLSX from "xlsx";
import { PayrollEmployee, PayrollParseResult } from "../types";
import { toNumber } from "../utils";

function findFirstDate(grid: any[][]): string | undefined {
  for (const row of grid) {
    for (const cell of row) {
      const s = String(cell ?? "");
      const m = s.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/);
      if (m) return m[0];
    }
  }
  return undefined;
}

function norm(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

function isPayTypeRow(row: any[]) {
  return norm(row?.[1]).includes("pay type");
}

function isOvertimeLabel(label: string) {
  const s = label.toLowerCase().trim();
  return s === "overtime" || s.startsWith("overtime") || /^ot\b/.test(s) || s.includes("over time");
}

function isHolLabel(label: string) {
  const s = label.toLowerCase().trim();
  return s === "hol" || s.startsWith("hol") || s.includes("holiday");
}

function isProbablyEmployeeName(s: string) {
  const t = (s || "").trim();
  if (!t) return false;
  const low = t.toLowerCase();
  // Exclude common report headers
  if (
    low.includes("payroll register") ||
    low.includes("report totals") ||
    low.includes("company") ||
    low.includes("department") ||
    low.includes("pay type") ||
    low.includes("totals") ||
    low === "taxes" ||
    low.includes("deductions")
  ) return false;

  // Must contain at least one letter
  if (!/[a-zA-Z]/.test(t)) return false;

  // Heuristic: two tokens is common ("First Last") OR all caps names
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return true;
  // Sometimes single-token last names; allow if it's alphabetic and not too short
  if (parts.length === 1 && parts[0].length >= 4 && /^[A-Za-z][A-Za-z\-']+$/.test(parts[0])) return true;

  return false;
}

function findEmployeeNameAbove(grid: any[][], payTypeRowIndex: number): string | undefined {
  for (let r = payTypeRowIndex - 1; r >= 0 && r >= payTypeRowIndex - 25; r--) {
    const cand = String(grid[r]?.[1] ?? "").trim();
    if (isProbablyEmployeeName(cand)) return cand;
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
  const seen = new Set<string>();

  let i = 0;
  while (i < grid.length) {
    if (!isPayTypeRow(grid[i])) {
      i++;
      continue;
    }

    const name = findEmployeeNameAbove(grid, i);
    if (!name) {
      i++;
      continue;
    }

    // Avoid double-parsing the same employee if the report repeats blocks
    const key = name.toLowerCase();
    if (seen.has(key)) {
      i++;
      continue;
    }

    let salaryAmt = 0;
    let overtimeAmt = 0;
    let overtimeHours = 0;
    let holAmt = 0;
    let holHours = 0;

    // Pay type rows start immediately after "Pay Type" header
    let j = i + 1;
    for (; j < grid.length; j++) {
      const r = grid[j];
      const label = String(r?.[1] ?? "").trim();
      const low = label.toLowerCase().trim();
      if (!label) continue;

      // Stop conditions: section headers or totals
      if (/^totals?:\s*$/i.test(label)) break;
      if (low.includes("deductions")) break;
      if (low.includes("taxes")) break;

      // Hours in col C, Amount in col D
      const hours = toNumber(r?.[2]);
      const amt = toNumber(r?.[3]);

      if (isOvertimeLabel(label)) {
        overtimeAmt += amt;
        overtimeHours += hours;
      } else if (isHolLabel(label)) {
        holAmt += amt;
        holHours += hours;
      } else {
        // Treat everything else in this section as "salary / regular earnings"
        salaryAmt += amt;
      }
    }

    // Find Deductions (ER) section after pay types
    let k = j;
    while (k < grid.length && !norm(grid[k]?.[1]).includes("deductions (er)")) k++;

    let er401k = 0;
    if (k < grid.length) {
      k++;
      for (; k < grid.length; k++) {
        const r = grid[k];
        const label = String(r?.[1] ?? "").trim();
        const low = label.toLowerCase();
        if (!label) continue;
        if (low.startsWith("taxes") || low.includes("taxes")) break;

        const amt = toNumber(r?.[3]);

        // Only employer 401k (ER)
        if (/401k/i.test(label) && /(er|employer)/i.test(label) && !/loan/i.test(label)) {
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
    seen.add(key);

    // Continue after ER section, but ensure forward progress
    i = Math.max(i + 1, k);
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
