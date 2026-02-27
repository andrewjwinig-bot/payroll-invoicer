import * as XLSX from "xlsx";
import { AllocationEmployee, AllocationTable, Property } from "../types";

/**
 * Allocation workbook structure varies (sometimes "Per Payroll Report" appears in a merged cell,
 * sometimes the header starts with blanks). We locate the header row by scoring rows for:
 *  - presence of many property codes (3-4 digit) and special headers (Marketing/Middletown/Eastwick/0800)
 *  - optional presence of "Per Payroll Report" anywhere in the row
 *
 * We also search across ALL sheets, using the best-scoring header we find.
 */

type WS = XLSX.WorkSheet;

const SPECIAL_HEADERS = new Set([
  "MARKETING",
  "MIDDLETOWN",
  "EASTWICK",
  "0800",
  "40A0",
  "40B0",
  "40C0",
]);

function norm(s: any) {
  return String(s ?? "").trim();
}

function upper(s: any) {
  return norm(s).toUpperCase();
}

function isPropertyHeaderCell(s: string) {
  const t = s.trim();
  if (!t) return false;
  if (/^\d{3,4}$/.test(t)) return true;
  if (SPECIAL_HEADERS.has(t.toUpperCase())) return true;
  return false;
}

function headerRowScore(row: any[]): { score: number; hasTitle: boolean } {
  const cells = row.map((c) => norm(c));
  const hasTitle = cells.some((c) => c.toLowerCase().includes("per payroll report"));
  const score = cells.filter((c) => isPropertyHeaderCell(c)).length + (hasTitle ? 3 : 0);
  return { score, hasTitle };
}

function findBestHeader(grid: any[][]) {
  let best = { r: -1, score: 0 };
  const limit = Math.min(grid.length, 100);
  for (let r = 0; r < limit; r++) {
    const { score } = headerRowScore(grid[r] || []);
    if (score > best.score) best = { r, score };
  }
  // Require at least a few property headers to avoid false positives
  if (best.r >= 0 && best.score >= 6) return best.r;
  return -1;
}

function toBool(v: any) {
  if (v === true) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "y" || s === "x" || s === "✓" || s === "☑";
}

function cleanEmployeeName(raw: any) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  // remove duplicated spaces
  return s.replace(/\s{2,}/g, " ").trim();
}

function isLikelyEmployeeName(raw: any) {
  const s = String(raw ?? "").trim();
  if (!s) return false;
  const low = s.toLowerCase();
  if (low.includes("per payroll report")) return false;
  if (low.includes("total")) return false;
  if (/^\d{3,4}$/.test(s)) return false;
  // must contain a letter
  return /[a-z]/i.test(s);
}

// Evaluate % cells: xlsx doesn't calculate formulas; rely on cached value if present.
// If cached value is missing, we fall back to the displayed text (.w) which Excel often stores.
function readPctCell(ws: WS, addr: string): number {
  const cell: any = (ws as any)[addr];
  if (!cell) return 0;

  // Prefer numeric cached value
  if (typeof cell.v === "number" && isFinite(cell.v)) {
    let v = cell.v;
    if (v > 1.5 && v <= 100) v = v / 100;
    return v;
  }

  const text = typeof cell.w === "string" ? cell.w : (typeof cell.v === "string" ? cell.v : "");
  const s = String(text ?? "").trim();
  if (!s || s === "-" || s === "—") return 0;

  const pm = s.match(/^(-?\d+(\.\d+)?)\s*%$/);
  if (pm) return parseFloat(pm[1]) / 100;

  const cleaned = s.replace(/[$,]/g, "");
  const n = Number(cleaned);
  if (!isFinite(n)) return 0;
  if (n > 1.5 && n <= 100) return n / 100;
  return n;
}

function buildPropertyNameMap(grid: any[][]): Record<string, string> {
  // Attempts to infer names from a mapping area (two columns) OR a second header row.
  const map: Record<string, string> = {};

  // Two-column mapping anywhere in sheet
  for (let r = 0; r < grid.length; r++) {
    const a = norm(grid[r]?.[0]);
    const b = norm(grid[r]?.[1]);
    if (!a || !b) continue;
    if (isPropertyHeaderCell(a) && !b.toLowerCase().includes("per payroll")) {
      map[a] = b;
    }
  }
  return map;
}

export function parseAllocationWorkbook(buf: Buffer): AllocationTable {
  const wb = XLSX.read(buf, { type: "buffer" });

  let bestSheetName: string | null = null;
  let bestHeaderRow = -1;
  let bestScore = 0;
  let bestGrid: any[][] | null = null;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as any[][];
    const headerRow = findBestHeader(grid);
    if (headerRow < 0) continue;
    const { score } = headerRowScore(grid[headerRow] || []);
    if (score > bestScore) {
      bestScore = score;
      bestSheetName = sheetName;
      bestHeaderRow = headerRow;
      bestGrid = grid;
    }
  }

  if (!bestSheetName || !bestGrid || bestHeaderRow < 0) {
    throw new Error("Could not locate allocation header row");
  }

  const ws = wb.Sheets[bestSheetName];
  const grid = bestGrid;

  const header = grid[bestHeaderRow] || [];

  // Identify columns
  let employeeCol = 0; // assume first column is employee name
  let recoverableCol: number | null = null;

  const propCols: { key: string; col: number }[] = [];

  for (let c = 0; c < header.length; c++) {
    const h = norm(header[c]);
    if (!h) continue;
    if (h === "8502") { recoverableCol = c; continue; }
    if (isPropertyHeaderCell(h)) {
      // Ignore the left-most employee column if it accidentally looks numeric
      if (c === 0) { employeeCol = 0; continue; }
      propCols.push({ key: h, col: c });
    }
  }

  // If header row didn't include 8502, still allow parsing (recoverable defaults false)
  // Build property list
  const nameMap = buildPropertyNameMap(grid);

  const properties: Property[] = propCols.map((p) => ({
    key: p.key,
    label: p.key,
    name: nameMap[p.key] || p.key,
  })) as any;

  const employees: AllocationEmployee[] = [];

  // Parse employee rows until blank-run or mapping area starts
  let blankRun = 0;
  for (let r = bestHeaderRow + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const rawEmp = row[employeeCol];

    if (!rawEmp || norm(rawEmp) === "") {
      blankRun++;
      if (blankRun >= 8) break;
      continue;
    }
    blankRun = 0;

    if (!isLikelyEmployeeName(rawEmp)) continue;

    const name = cleanEmployeeName(rawEmp);
    if (!name) continue;

    // Stop if we hit a property mapping area (first cell becomes numeric code)
    if (isPropertyHeaderCell(String(rawEmp))) break;

    const recoverable = recoverableCol != null ? toBool(row[recoverableCol]) : false;

    const allocations: Record<string, number> = {};
    for (const pc of propCols) {
      const addr = XLSX.utils.encode_cell({ c: pc.col, r });
      allocations[pc.key] = readPctCell(ws, addr);
    }

    employees.push({ name, recoverable, allocations });
  }

  if (employees.length === 0) {
    throw new Error("Parsed 0 employees from allocation workbook (check that employee names are in the first column under the header row).");
  }

  return { properties, employees };
}
