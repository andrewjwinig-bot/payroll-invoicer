import * as XLSX from "xlsx";
import { AllocationEmployeeRow, AllocationTable } from "../types";
import { toNumber } from "../utils";

/**
 * Parses the allocation workbook.
 *
 * Supports two formats:
 * 1) Original complex allocation workbook (groups/PRS/marketing).
 * 2) Simplified table format:
 *    - First column contains employee names (header like "Employee" or "Employee Name")
 *    - Remaining columns are property codes/names (e.g., "2010", "4900", "Middletown")
 *    - Cells are % allocations (e.g., 0.25, 25, "25%")
 *    - Optional column "8502" or "REC" indicates recoverable (TRUE/FALSE, Y/N, 1/0)
 *
 * The simplified format is preferred for reliability.
 */

function normalizeHeader(s: any): string {
  return String(s ?? "").trim();
}

function isTruthy(v: any): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "t" || s === "yes" || s === "y" || s === "1" || s === "checked";
}

function normalizePct(v: any): number {
  if (v == null || String(v).trim() === "") return 0;
  const s = String(v).trim();
  // Handle "25%" style
  if (s.endsWith("%")) {
    const n = toNumber(s.slice(0, -1));
    return n ? n / 100 : 0;
  }
  const n = toNumber(v);
  if (!n) return 0;
  // If user typed 25 instead of 0.25
  return n > 1 ? n / 100 : n;
}

function looksLikeSimpleTable(headers: string[]): boolean {
  const h0 = (headers[0] ?? "").toLowerCase();
  const hasEmployee = h0.includes("employee");
  const hasManyProps = headers.slice(1).filter((h) => h.length > 0).length >= 2;
  return hasEmployee && hasManyProps;
}

function parseSimpleAllocation(grid: any[][]): AllocationTable {
  const headerRow = grid.find((r) => (r?.[0] ?? "").toString().toLowerCase().includes("employee"));
  if (!headerRow) throw new Error("Could not locate allocation header row");

  const headers = headerRow.map(normalizeHeader);
  const idxEmployee = 0;

  // Detect recoverable column
  let idxRecoverable = -1;
  for (let i = 1; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    if (h === "8502" || h.includes("recover") || h.includes("rec")) {
      // But don't treat property code 2010 etc as recoverable
      if (h === "8502" || h.includes("recover") || h === "rec") {
        idxRecoverable = i;
        break;
      }
    }
  }

  // Property columns are all columns except employee and recoverable
  const propCols: { idx: number; key: string }[] = [];
  for (let i = 1; i < headers.length; i++) {
    if (i === idxRecoverable) continue;
    const key = headers[i];
    if (!key) continue;
    propCols.push({ idx: i, key });
  }

  const employees: AllocationEmployeeRow[] = [];

  // Find starting row index
  const startIdx = grid.indexOf(headerRow) + 1;
  for (let r = startIdx; r < grid.length; r++) {
    const row = grid[r] || [];
    const name = String(row[idxEmployee] ?? "").trim();
    if (!name) continue;

    const recoverable = idxRecoverable >= 0 ? isTruthy(row[idxRecoverable]) : false;

    const top: Record<string, number> = {};
    for (const c of propCols) {
      const pct = normalizePct(row[c.idx]);
      if (pct) top[c.key] = pct;
    }

    // Normalize to sum 1 (so users can type partials or rounding)
    const sum = Object.values(top).reduce((a, b) => a + b, 0);
    if (sum > 0) {
      for (const k of Object.keys(top)) top[k] = top[k] / sum;
    }

    employees.push({
      name,
      recoverable,
      top,
      marketingToGroups: {},
    } as any);
  }

  // Build property meta from headers
  const propertyMeta: AllocationTable["propertyMeta"] = {};
  for (const c of propCols) {
    const key = c.key;
    const trimmed = key.trim();
    const isCode = /^\d{3,5}$/.test(trimmed);
    propertyMeta[key] = {
      label: trimmed,
      code: isCode ? trimmed.padStart(4, "0") : undefined,
    };
  }

  // Simplified format doesn't use PRS tables
  const prsEmpty: any = { salaryREC: {}, salaryNR: {} };

  return { employees, prs: prsEmpty, propertyMeta };
}

/**
 * Legacy complex format parser (kept for backward compatibility).
 * If your workbook is in the old format, this will still attempt to parse it.
 */
function parseLegacyAllocation(buf: Buffer): AllocationTable {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as any[][];

  // Try to locate the "Per Payroll Report" section header row
  let headerIdx = -1;
  for (let r = 0; r < grid.length; r++) {
    const v = String(grid[r]?.[0] ?? "").trim();
    if (/per\s+payroll\s+report/i.test(v)) {
      headerIdx = r;
      break;
    }
  }
  if (headerIdx < 0) throw new Error("Could not locate allocation header row");

  const headers = (grid[headerIdx] || []).map((c) => String(c ?? "").trim());
  const colName = 0;
  const colRecoverable = headers.findIndex((h) => h === "8502" || /recover/i.test(h));

  // property columns are any column with a non-empty header after colName and before blank tail
  const propCols: { idx: number; key: string }[] = [];
  for (let i = 1; i < headers.length; i++) {
    const key = headers[i];
    if (!key) continue;
    if (i === colRecoverable) continue;
    propCols.push({ idx: i, key });
  }

  const employees: AllocationEmployeeRow[] = [];
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const name = String(row[colName] ?? "").trim();
    if (!name) continue;

    const recoverable = colRecoverable >= 0 ? isTruthy(row[colRecoverable]) : false;

    const top: Record<string, number> = {};
    for (const c of propCols) {
      const pct = normalizePct(row[c.idx]);
      if (pct) top[c.key] = pct;
    }
    const sum = Object.values(top).reduce((a, b) => a + b, 0);
    if (sum > 0) for (const k of Object.keys(top)) top[k] = top[k] / sum;

    employees.push({ name, recoverable, top } as any);
  }

  const propertyMeta: AllocationTable["propertyMeta"] = {};
  for (const c of propCols) {
    const key = c.key;
    const trimmed = key.trim();
    const isCode = /^\d{3,5}$/.test(trimmed);
    propertyMeta[key] = {
      label: trimmed,
      code: isCode ? trimmed.padStart(4, "0") : undefined,
    };
  }

  const prsEmpty: any = { salaryREC: {}, salaryNR: {} };
  return { employees, prs: prsEmpty, propertyMeta };
}

export function parseAllocationWorkbook(buf: Buffer): AllocationTable {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as any[][];

  // Try simplified table first
  const headerRow = grid.find((r) => (r?.[0] ?? "").toString().toLowerCase().includes("employee"));
  if (headerRow) {
    const headers = headerRow.map(normalizeHeader);
    if (looksLikeSimpleTable(headers)) {
      return parseSimpleAllocation(grid);
    }
  }

  // Fallback to legacy (older workbook variants)
  return parseLegacyAllocation(buf);
}
