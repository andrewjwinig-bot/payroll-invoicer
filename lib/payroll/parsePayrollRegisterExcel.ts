import * as XLSX from "xlsx";
import { PayrollEmployee, PayrollParseResult } from "../types";
import { toNumber } from "../utils";

/**
 * Column-based parser tailored to your payroll export layout:
 * - Employee name appears in column B (index 1), e.g. at B9, B36, ...
 * - Inside an employee block, line-item labels are in column B (index 1)
 * - Amounts are in column D (index 3)
 * - Blocks are separated by blank rows in column B
 *
 * This approach is intentionally simple/stable and avoids "smart scanning"
 * that can accidentally zero-out the whole sheet.
 */

function asText(v: any): string {
  return String(v ?? "").trim();
}

function cleanName(raw: string) {
  return (raw || "")
    .replace(/\s*Default\s*-\s*#\d+\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeEmployeeName(s: string): boolean {
  const t = asText(s);
  if (!t) return false;
  const low = t.toLowerCase();
  if (low.includes("payroll register")) return false;
  if (low.includes("report totals")) return false;
  if (low.includes("pay type")) return false;
  if (low === "regular pay" || low.startsWith("regular pay")) return false;
  if (low === "overtime" || low.startsWith("overtime")) return false;
  if (low === "hol" || low.startsWith("hol")) return false;
  if (low.includes("deductions")) return false;
  if (low.includes("taxes")) return false;

  // typical: "FIRST LAST" OR "LAST, FIRST" OR "ANDREW WINIG  Default - #10"
  const hasLetters = /[A-Za-z]/.test(t);
  const parts = t.replace(",", " ").split(/\s+/).filter(Boolean);
  return hasLetters && parts.length >= 2;
}

function labelMatches(label: string, needle: RegExp) {
  return needle.test(label.toLowerCase());
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

export function parsePayrollRegisterExcel(buf: Buffer): PayrollParseResult {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as any[][];

  const payDate = findFirstDate(grid);

  const employees: PayrollEmployee[] = [];

  let r = 0;
  while (r < grid.length) {
    const nameCell = asText(grid[r]?.[1]); // column B
    if (!looksLikeEmployeeName(nameCell)) {
      r++;
      continue;
    }

    const name = cleanName(nameCell);

    let salaryAmt = 0;
    let overtimeAmt = 0;
    let overtimeHours = 0; // if present, usually col C, but keep 0 if not reliable
    let holAmt = 0;
    let holHours = 0;
    let er401k = 0;

    // scan down until next employee name or we hit a long blank gap
    let blankRun = 0;
    r++; // start after the name row
    for (; r < grid.length; r++) {
      const label = asText(grid[r]?.[1]); // column B label
      const amount = toNumber(grid[r]?.[3]); // column D amount

      const possibleNextName = asText(grid[r]?.[1]);
      // if a new employee name appears, stop block
      if (looksLikeEmployeeName(possibleNextName) && possibleNextName !== label) {
        break;
      }

      if (!label) {
        blankRun++;
        if (blankRun >= 6) break;
        continue;
      }
      blankRun = 0;

      // Pay lines
      if (labelMatches(label, /^regular pay\b/)) {
        salaryAmt += amount;
        continue;
      }
      if (labelMatches(label, /^overtime\b/) || labelMatches(label, /^ot\b/)) {
        overtimeAmt += amount;
        // hours sometimes in column C (index 2)
        const hrs = toNumber(grid[r]?.[2]);
        overtimeHours += hrs;
        continue;
      }
      if (labelMatches(label, /^hol\b/) || labelMatches(label, /holiday/)) {
        holAmt += amount;
        const hrs = toNumber(grid[r]?.[2]);
        holHours += hrs;
        continue;
      }

      // 401K ER: look for any label containing "401" and "ER"/"Employer"
      const low = label.toLowerCase();
      if (low.includes("401") && (low.includes(" er") || low.includes("(er") || low.includes("employer")) && !low.includes(" ee") && !low.includes("(ee")) {
        er401k += amount;
        continue;
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
