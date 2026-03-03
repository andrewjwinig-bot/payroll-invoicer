import * as XLSX from "xlsx";
import { AllocationEmployee, AllocationTable, Property } from "../types";

function asText(v: any): string {
  return String(v ?? "").trim();
}

function isPropHeader(s: string): boolean {
  if (!s) return false;
  const up = s.toUpperCase();
  if (["MARKETING","MIDDLETOWN","EASTWICK","0800","40A0","40B0","40C0"].includes(up)) return true;
  return /^\d{3,4}$/.test(s);
}

function readPct(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number" && isFinite(v)) return v > 1.5 ? v / 100 : v;
  const s = asText(v);
  if (!s || s === "-" || s === "—") return 0;
  const pm = s.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (pm) return parseFloat(pm[1]) / 100;
  const n = Number(s.replace(/[$,]/g, ""));
  if (!isFinite(n)) return 0;
  return n > 1.5 ? n / 100 : n;
}

function toRecoverable(v: any): boolean {
  const s = asText(v).toUpperCase();
  return s === "REC" || s === "TRUE" || s === "YES" || s === "Y" || s === "1" || s === "X" || s === "✓" || s === "☑";
}

/**
 * Robust employeeKey normalization:
 * - lowercases
 * - strips ALL non letters (including NBSP / weird pipes)
 * - outputs canonical "last|first"
 *
 * Accepts inputs like:
 * - "Loiseau|Charles"
 * - "loiseau | charles"
 * - "loiseau‖charles" (unicode)
 * - "loiseau/charles"
 */
function normalizeEmployeeKey(v: any): string | undefined {
  const raw = asText(v);
  if (!raw) return undefined;
  const lower = raw.toLowerCase();

  // Split on anything that is NOT a letter (handles spaces, pipes, unicode separators)
  const parts = lower.split(/[^a-z]+/).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[0];
    const first = parts[1];
    return `${last}|${first}`;
  }
  return undefined;
}

export function parseAllocationWorkbook(buf: Buffer): AllocationTable {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as any[][];

  // Find header row containing EmployeeName + EmployeeKey anywhere in the first 20 columns
  let headerRow = -1;
  let nameCol = -1;
  let keyCol = -1;
  for (let r = 0; r < Math.min(grid.length, 80); r++) {
    const row = grid[r] || [];
    for (let c = 0; c < Math.min(row.length, 25); c++) {
      const a = asText(row[c]).toLowerCase();
      const b = asText(row[c + 1]).toLowerCase();
      if (a === "employeename" && b === "employeekey") {
        headerRow = r;
        nameCol = c;
        keyCol = c + 1;
        break;
      }
    }
    if (headerRow !== -1) break;
  }
  if (headerRow === -1) throw new Error("Could not locate allocation header row (expected EmployeeName / EmployeeKey).");

  const header = grid[headerRow] || [];
  let recoverableCol = -1;
  const propCols: { key: string; col: number }[] = [];

  for (let c = 0; c < header.length; c++) {
    const h = asText(header[c]);
    if (!h) continue;
    if (h.toLowerCase() === "recoverable") recoverableCol = c;
    if (isPropHeader(h)) propCols.push({ key: h, col: c });
  }

  // Property Code -> Property Name mapping
  const nameMap: Record<string, string> = {};
  for (let r = headerRow + 1; r < grid.length; r++) {
    if (asText(grid[r]?.[0]) === "Property Code" && asText(grid[r]?.[1]) === "Property Name") {
      for (let k = r + 1; k < grid.length; k++) {
        const code = asText(grid[k]?.[0]);
        const nm = asText(grid[k]?.[1]);
        if (!code) break;
        nameMap[code] = nm;
      }
      break;
    }
  }

  const properties: Property[] = propCols.map((p) => ({
    key: p.key,
    label: p.key,
    name: nameMap[p.key] || "",
  })) as any;

  const employees: AllocationEmployee[] = [];
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const empName = asText(row[nameCol]);
    if (!empName) continue;
    if (empName === "Property Code") break;

    const employeeKey = normalizeEmployeeKey(row[keyCol]);
    const recoverable = recoverableCol >= 0 ? toRecoverable(row[recoverableCol]) : false;

    const allocations: Record<string, number> = {};
    for (const pc of propCols) allocations[pc.key] = readPct(row[pc.col]);

    employees.push({ name: empName, employeeKey, recoverable, allocations });
  }

  return { properties, employees };
}
