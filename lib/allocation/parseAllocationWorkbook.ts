import * as XLSX from "xlsx";
import { AllocationEmployee, AllocationTable, Property } from "../types";

type WS = XLSX.WorkSheet;

const SPECIAL_HEADERS = new Set(["MARKETING", "MIDDLETOWN", "EASTWICK", "0800", "40A0", "40B0", "40C0"]);

function asText(v: any): string {
  return String(v ?? "").trim();
}

function isPropHeader(v: any): boolean {
  const s = asText(v);
  if (!s) return false;
  const up = s.toUpperCase();
  if (SPECIAL_HEADERS.has(up)) return true;
  return /^\d{3,4}$/.test(s);
}

function cell(ws: WS, r: number, c: number): any {
  const addr = XLSX.utils.encode_cell({ r, c });
  return (ws as any)[addr];
}

function cellText(ws: WS, r: number, c: number): string {
  const ce: any = cell(ws, r, c);
  if (!ce) return "";
  if (ce.w != null && String(ce.w).trim() !== "") return String(ce.w).trim();
  if (ce.v != null && String(ce.v).trim() !== "") return String(ce.v).trim();
  return "";
}

function readPct(ws: WS, r: number, c: number): number {
  const ce: any = cell(ws, r, c);
  if (!ce) return 0;

  const raw: any = ce.v;
  if (typeof raw === "number" && isFinite(raw)) {
    let v = raw;
    if (v > 1.5 && v <= 100) v = v / 100;
    return v;
  }

  const s = (ce.w != null ? String(ce.w) : String(ce.v ?? "")).trim();
  if (!s || s === "-" || s === "—") return 0;

  const pm = s.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (pm) return parseFloat(pm[1]) / 100;

  const cleaned = s.replace(/[$,]/g, "");
  const n = Number(cleaned);
  if (!isFinite(n)) return 0;
  if (n > 1.5 && n <= 100) return n / 100;
  return n;
}

function findHeaderRowByScan(ws: WS): { row: number; score: number; maxCol: number } | null {
  const ref = ws["!ref"] as string | undefined;
  const range = ref ? XLSX.utils.decode_range(ref) : { s: { r: 0, c: 0 }, e: { r: 250, c: 120 } };

  const maxRow = Math.min(range.e.r, 250);
  const maxCol = Math.min(range.e.c, 200);

  let bestRow = -1;
  let bestScore = 0;

  for (let r = 0; r <= maxRow; r++) {
    let score = 0;
    for (let c = 0; c <= maxCol; c++) {
      const t = cellText(ws, r, c);
      if (isPropHeader(t)) score++;
    }
    for (let c = 0; c <= Math.min(maxCol, 10); c++) {
      const t = cellText(ws, r, c).toLowerCase();
      if (t.includes("per payroll report")) score += 3;
    }
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }

  if (bestRow >= 0 && bestScore >= 6) return { row: bestRow, score: bestScore, maxCol };
  return null;
}

function isLikelyEmployeeName(v: any): boolean {
  const s = asText(v);
  if (!s) return false;
  const low = s.toLowerCase();
  if (low.includes("per payroll report")) return false;
  if (low === "employee" || low.includes("employees")) return false;
  if (low.includes("total")) return false;
  if (isPropHeader(s)) return false;
  return /[a-z]/i.test(s);
}

function toRecoverable(v: any): boolean {
  if (v === true) return true;
  const s = asText(v).toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "y" || s === "x" || s === "✓" || s === "☑";
}

export function parseAllocationWorkbook(buf: Buffer): AllocationTable {
  const wb = XLSX.read(buf, { type: "buffer" });

  let pickedSheet: string | null = null;
  let headerRow = -1;
  let maxCol = 0;
  let bestScore = 0;

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const found = findHeaderRowByScan(ws);
    if (found && found.score > bestScore) {
      bestScore = found.score;
      pickedSheet = name;
      headerRow = found.row;
      maxCol = found.maxCol;
    }
  }

  if (!pickedSheet || headerRow < 0) throw new Error("Could not locate allocation header row");
  const ws = wb.Sheets[pickedSheet];

  const propCols: { key: string; col: number }[] = [];
  let recoverableCol: number | null = null;

  for (let c = 0; c <= maxCol; c++) {
    const h = cellText(ws, headerRow, c);
    if (!h) continue;
    if (h === "8502") { recoverableCol = c; continue; }
    if (isPropHeader(h)) {
      if (c === 0) continue;
      propCols.push({ key: h, col: c });
    }
  }

  // Optional property names row immediately under header row
  const nameRow = headerRow + 1;
  let looksLikeNameRow = cellText(ws, nameRow, 0) === "" || cellText(ws, nameRow, 0).toLowerCase().includes("property");
  let nameCount = 0;
  for (const pc of propCols) {
    const t = cellText(ws, nameRow, pc.col);
    if (t && /[a-z]/i.test(t)) nameCount++;
  }
  if (nameCount < Math.max(3, Math.floor(propCols.length * 0.3))) looksLikeNameRow = false;

  const properties: Property[] = propCols.map((p) => ({
    key: p.key,
    label: p.key,
    name: looksLikeNameRow ? cellText(ws, nameRow, p.col) : p.key,
  })) as any;

  const employees: AllocationEmployee[] = [];
  let blankRun = 0;
  const startRow = looksLikeNameRow ? headerRow + 2 : headerRow + 1;

  for (let r = startRow; r <= startRow + 800; r++) {
    const nameCell = cellText(ws, r, 0);
    if (!nameCell) {
      blankRun++;
      if (blankRun >= 10) break;
      continue;
    }
    blankRun = 0;

    if (!isLikelyEmployeeName(nameCell)) continue;
    if (isPropHeader(nameCell)) break;

    const recoverable = recoverableCol != null ? toRecoverable(cellText(ws, r, recoverableCol)) : false;

    const allocations: Record<string, number> = {};
    for (const pc of propCols) allocations[pc.key] = readPct(ws, r, pc.col);

    employees.push({ name: nameCell, recoverable, allocations });
  }

  if (!employees.length) throw new Error("Parsed 0 employees from allocation workbook (header found but no employee rows detected).");
  return { properties, employees };
}
