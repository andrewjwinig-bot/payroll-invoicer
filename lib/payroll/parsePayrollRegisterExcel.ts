import * as XLSX from "xlsx";
import { PayrollEmployee, PayrollParseResult } from "../types";
import { toNumber } from "../utils";

/**
 * SUPER ROBUST parser for the Payroll Register export.
 *
 * Why: The export is not perfectly consistent per-employee (columns shift), which caused:
 * - some employees (Andrew/Charles) not being parsed at all
 * - 401K ER always showing 0 because the label/amount columns shifted
 *
 * Strategy:
 * - Find each employee section by locating a row containing "Pay Type" anywhere.
 * - Determine employee name by scanning up to 40 rows above for a cell containing "Default - #"
 *   or a 2+ token name-like string.
 * - For each section, scan rows until the next "Pay Type" or "Report Totals".
 * - For each row, detect category by text anywhere in the row and take the RIGHTMOST numeric
 *   as the amount (hours are taken as the LEFTMOST numeric in the row that looks like hours).
 */

function norm(v: any): string {
  return String(v ?? "").trim().toLowerCase();
}

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

function rowHas(gridRow: any[], needle: string): boolean {
  const n = needle.toLowerCase();
  return (gridRow || []).some((c) => norm(c).includes(n));
}

function findCellContaining(row: any[], needle: string): { col: number; text: string } | null {
  const n = needle.toLowerCase();
  for (let c = 0; c < (row?.length ?? 0); c++) {
    const t = String(row[c] ?? "").trim();
    if (t && t.toLowerCase().includes(n)) return { col: c, text: t };
  }
  return null;
}

function cleanPayrollName(raw: string) {
  return (raw || "")
    .replace(/\s*Default\s*-\s*#\d+\s*$/i, "")
    .replace(/[,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyNameCell(s: string) {
  const t = (s || "").trim();
  if (!t) return false;
  const low = t.toLowerCase();
  if (
    low.includes("payroll register") ||
    low.includes("report totals") ||
    low.includes("company") ||
    low.includes("department") ||
    low.includes("pay type") ||
    low.includes("totals") ||
    low.includes("taxes") ||
    low.includes("deductions")
  ) return false;

  if (!/[a-zA-Z]/.test(t)) return false;

  // Prefer rows that include "Default - #"
  if (/default\s*-\s*#\d+/i.test(t)) return true;

  // Otherwise, 2+ tokens
  const parts = t.split(/\s+/).filter(Boolean);
  return parts.length >= 2;
}

function findEmployeeNameAbove(grid: any[][], startRow: number): string | undefined {
  for (let r = startRow - 1; r >= 0 && r >= startRow - 40; r--) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] ?? "").trim();
      if (isLikelyNameCell(cell)) return cell;
    }
  }
  return undefined;
}

function rightmostNumber(row: any[]): number {
  for (let c = (row?.length ?? 0) - 1; c >= 0; c--) {
    const n = toNumber(row?.[c]);
    if (n !== 0 || String(row?.[c] ?? "").trim() === "0" || String(row?.[c] ?? "").trim() === "0.00") {
      // accept numeric-looking
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}

function leftmostHours(row: any[]): number {
  // hours tend to be small numbers, often with decimals, and appear before amount
  for (let c = 0; c < (row?.length ?? 0); c++) {
    const raw = row?.[c];
    const n = toNumber(raw);
    if (Number.isNaN(n)) continue;
    // Heuristic: hours usually between 0 and 200
    if (n >= 0 && n <= 200) return n;
  }
  return 0;
}

function isOvertimeRow(row: any[]): boolean {
  return rowHas(row, "overtime") || rowHas(row, "over time") || rowHas(row, "ot ");
}

function isHolidayRow(row: any[]): boolean {
  // HOL / Holiday
  return rowHas(row, " hol") || norm(row?.[0]).startsWith("hol") || rowHas(row, "holiday");
}

function isRegularPayRow(row: any[]): boolean {
  return rowHas(row, "regular pay") || rowHas(row, "regular") || rowHas(row, "salary");
}

function is401kErRow(row: any[]): boolean {
  const all = (row || []).map((c) => norm(c)).join(" ");
  if (!all.includes("401")) return false;
  if (all.includes("loan")) return false;
  // must be ER / employer, and NOT EE
  const hasEr = all.includes(" er") || all.includes("employer") || all.includes("(er)") || all.includes("401k er");
  const hasEe = all.includes(" ee") || all.includes("(ee)") || all.includes("employee");
  return hasEr && !hasEe;
}

export function parsePayrollRegisterExcel(buf: Buffer): PayrollParseResult {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as any[][];

  const payDate = findFirstDate(grid);

  const employees: PayrollEmployee[] = [];
  const seen = new Set<string>();

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    if (!rowHas(row, "pay type")) continue;

    const rawName = findEmployeeNameAbove(grid, r);
    if (!rawName) continue;

    const name = cleanPayrollName(rawName);
    const key = name.toLowerCase();

    if (seen.has(key)) continue;

    let salaryAmt = 0;
    let overtimeAmt = 0;
    let overtimeHours = 0;
    let holAmt = 0;
    let holHours = 0;
    let er401k = 0;

    // scan forward until next "Pay Type" or "Report Totals" (or 250 rows)
    for (let k = r + 1; k < Math.min(grid.length, r + 250); k++) {
      const rr = grid[k] || [];
      if (k > r + 1 && rowHas(rr, "pay type")) break;
      if (rowHas(rr, "report totals")) break;

      if (is401kErRow(rr)) {
        er401k += rightmostNumber(rr);
        continue;
      }

      if (isOvertimeRow(rr)) {
        overtimeAmt += rightmostNumber(rr);
        overtimeHours += leftmostHours(rr);
        continue;
      }

      if (isHolidayRow(rr)) {
        holAmt += rightmostNumber(rr);
        holHours += leftmostHours(rr);
        continue;
      }

      if (isRegularPayRow(rr)) {
        // Only treat as salary if it's clearly a pay type line; avoid random headers
        const amt = rightmostNumber(rr);
        if (amt !== 0) salaryAmt += amt;
      }
    }

    employees.push({ name, salaryAmt, overtimeAmt, overtimeHours, holAmt, holHours, er401k });
    seen.add(key);
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
