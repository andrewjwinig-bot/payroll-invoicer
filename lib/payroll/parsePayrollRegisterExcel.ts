import * as XLSX from "xlsx";
import { PayrollEmployee, PayrollParseResult } from "../types";
import { toNumber } from "../utils";

/**
 * Parses the "Payroll Register Summary" style export where each employee is a variable-length block.
 * Observed patterns (from your sample):
 * - Employee name appears in column B (e.g., B9, B36, ...)
 * - Line item labels are in column B and amounts are in column D
 * - Pay types include: "Regular Pay", "HOL", "Overtime" (names may vary slightly)
 * - 401K ER is under a section like "Deductions (ER)" with a line containing "401K"
 *
 * This parser is designed to be tolerant of extra rows and inconsistent block sizes by using
 * section/header detection instead of fixed row ranges.
 */
export function parsePayrollRegisterExcel(buf: ArrayBuffer | Buffer): PayrollParseResult {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });

  // Helper to read a cell by 0-based row/col from the AoA
  const cell = (r: number, c: number) => (rows[r] && rows[r][c] != null ? rows[r][c] : "");

  // --- Pay Date (best-effort) ---
  // Scan top ~40 rows for something like "Pay Date" and a date value nearby.
  let payDate: string | null = null;
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const line = String(cell(r, 0) ?? "") + " " + String(cell(r, 1) ?? "") + " " + String(cell(r, 2) ?? "");
    const m = line.match(/pay\s*date\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    if (m) {
      payDate = m[1];
      break;
    }
    // Sometimes date might be in an adjacent cell
    const b = String(cell(r, 1) ?? "");
    if (/pay\s*date/i.test(b)) {
      const near = String(cell(r, 2) ?? "") || String(cell(r, 3) ?? "") || String(cell(r, 0) ?? "");
      const m2 = near.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
      if (m2) {
        payDate = m2[1];
        break;
      }
    }
  }

  // --- Report Totals (best-effort) ---
  // Your UI pills come from "Report Total" section. We'll scan for lines that contain totals.
  // If we can't find them, we leave as 0; the per-employee totals still drive invoices.
  const reportTotals = {
    salaryTotal: 0,
    overtimeHoursTotal: 0,
    overtimeAmtTotal: 0,
    holHoursTotal: 0,
    holAmtTotal: 0,
    er401kTotal: 0,
  };

  // Scan entire sheet for a "Report Total" block and parse recognizable labels in col B with amounts in col D.
  for (let r = 0; r < rows.length; r++) {
    const b = String(cell(r, 1) ?? "").trim();
    if (/report\s*total/i.test(b)) {
      // look forward some rows for totals
      for (let k = r; k < Math.min(rows.length, r + 30); k++) {
        const label = String(cell(k, 1) ?? "").trim();
        const amt = toNumber(cell(k, 3));
        const hrs = toNumber(cell(k, 2)); // sometimes hours are in col C

        if (/regular/i.test(label)) reportTotals.salaryTotal = amt || reportTotals.salaryTotal;
        if (/overtime/i.test(label)) {
          reportTotals.overtimeAmtTotal = amt || reportTotals.overtimeAmtTotal;
          if (hrs) reportTotals.overtimeHoursTotal = hrs;
        }
        if (/\bhol\b|holiday/i.test(label)) {
          reportTotals.holAmtTotal = amt || reportTotals.holAmtTotal;
          if (hrs) reportTotals.holHoursTotal = hrs;
        }
        if (/401k/i.test(label) && /\ber\b|employer/i.test(label)) reportTotals.er401kTotal = amt || reportTotals.er401kTotal;
      }
      break;
    }
  }

  // --- Employee Blocks ---
  // Determine likely employee header rows: a non-empty column B where column D is empty,
  // and next few rows include known section headers like "Pay Type" or known pay labels.
  const employees: PayrollEmployee[] = [];

  const isPotentialEmployeeName = (v: any) => {
    const s = String(v ?? "").trim();
    if (!s) return false;
    // Exclude obvious headings
    if (/pay\s*type|deductions|tax|report\s*total|totals?/i.test(s)) return false;
    // Names usually have letters and a space
    return /[A-Za-z]/.test(s) && (s.includes(" ") || s.includes(","));
  };

  const norm = (v: any) => String(v ?? "").trim();

  let i = 0;
  while (i < rows.length) {
    const nameCandidate = norm(cell(i, 1)); // col B
    const dVal = norm(cell(i, 3)); // col D
    if (isPotentialEmployeeName(nameCandidate) && dVal === "") {
      const name = nameCandidate;

      // Walk forward until next employee name or end.
      let k = i + 1;

      let inPayType = false;
      let inDedER = false;

      let salaryAmt = 0;
      let overtimeAmt = 0;
      let overtimeHours = 0;
      let holAmt = 0;
      let holHours = 0;
      let er401kAmt = 0;

      while (k < rows.length) {
        const b = norm(cell(k, 1));
        const d = toNumber(cell(k, 3));
        const c = toNumber(cell(k, 2));

        // Stop if next employee starts
        if (k !== i && isPotentialEmployeeName(b) && norm(cell(k, 3)) === "") break;

        // Section switches
        if (/pay\s*type/i.test(b)) {
          inPayType = true;
          inDedER = false;
          k++;
          continue;
        }
        if (/deductions\s*\(er\)|employer\s*deductions/i.test(b)) {
          inDedER = true;
          inPayType = false;
          k++;
          continue;
        }
        if (/deductions\s*\(ee\)|employee\s*deductions/i.test(b)) {
          // ignore EE
          inDedER = false;
          inPayType = false;
          k++;
          continue;
        }
        if (/tax/i.test(b)) {
          inDedER = false;
          inPayType = false;
          k++;
          continue;
        }

        // Pay types (labels in col B, amounts in col D)
        if (inPayType) {
          if (/regular/i.test(b)) salaryAmt += d;
          if (/overtime|\bot\b/i.test(b)) {
            overtimeAmt += d;
            if (c) overtimeHours += c;
          }
          if (/\bhol\b|holiday/i.test(b)) {
            holAmt += d;
            if (c) holHours += c;
          }
        }

        // ER deductions
        if (inDedER) {
          if (/401k/i.test(b)) er401kAmt += d;
        }

        k++;
      }

      employees.push({
        name,
        salaryAmt,
        overtimeAmt,
        overtimeHours,
        holAmt,
        holHours,
        er401kAmt,
      } as PayrollEmployee);

      i = k;
      continue;
    }

    i++;
  }

  // If reportTotals salary wasn't found, derive it from employees.
  if (!reportTotals.salaryTotal) reportTotals.salaryTotal = employees.reduce((s, e) => s + (e.salaryAmt || 0), 0);
  if (!reportTotals.overtimeAmtTotal) reportTotals.overtimeAmtTotal = employees.reduce((s, e) => s + (e.overtimeAmt || 0), 0);
  if (!reportTotals.overtimeHoursTotal) reportTotals.overtimeHoursTotal = employees.reduce((s, e) => s + ((e as any).overtimeHours || 0), 0);
  if (!reportTotals.holAmtTotal) reportTotals.holAmtTotal = employees.reduce((s, e) => s + (e.holAmt || 0), 0);
  if (!reportTotals.holHoursTotal) reportTotals.holHoursTotal = employees.reduce((s, e) => s + (e.holHours || 0), 0);
  if (!reportTotals.er401kTotal) reportTotals.er401kTotal = employees.reduce((s, e) => s + (e.er401kAmt || 0), 0);

  return {
    payDate: payDate ?? undefined,
    reportTotals,
    employees,
  } as PayrollParseResult;
}
