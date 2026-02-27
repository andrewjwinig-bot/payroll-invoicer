import * as XLSX from "xlsx";
import { AllocationEmployee, AllocationTable, Property } from "../types";

const CHECKED = new Set(["true","yes","y","1","x","checked","☑","✅","✔","✓"]);

function s(v: any) {
  if (v == null) return "";
  return String(v).trim();
}
function norm(v: any) {
  return s(v).toLowerCase().replace(/\s+/g, " ").trim();
}

function isPropCode(v: any) {
  const t = s(v);
  if (/^\d{3,4}$/.test(t)) return true;
  if (norm(t) === "middletown") return true;
  return false;
}

function pctFrom(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number" && isFinite(v)) return v > 1.5 ? v / 100 : v;
  const t = s(v);
  if (!t) return 0;
  if (t.endsWith("%")) {
    const n = parseFloat(t.replace("%",""));
    return isFinite(n) ? n/100 : 0;
  }
  const n = Number(t);
  if (!isFinite(n)) return 0;
  return n > 1.5 ? n/100 : n;
}

function truthy(v: any): boolean {
  if (v === true) return true;
  if (v === false) return false;
  const t = norm(v);
  return CHECKED.has(t);
}

export function parseAllocationWorkbook(buf: Buffer): AllocationTable {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false });

  let headerRow = -1;
  let bestCount = 0;
  for (let r = 0; r < Math.min(rows.length, 250); r++) {
    const row = rows[r] || [];
    const count = row.filter(isPropCode).length;
    if (count >= 2 && count > bestCount) {
      bestCount = count;
      headerRow = r;
    }
  }
  if (headerRow === -1) throw new Error("Could not locate allocation header row");

  const header = rows[headerRow] || [];
  const namesRow = rows[headerRow + 1] || [];

  let nameCol = -1;
  let recCol = -1;
  for (let c = 0; c < header.length; c++) {
    const h = norm(header[c]);
    if (nameCol === -1 && (h.includes("employee") || h === "name" || h.includes("employee name"))) nameCol = c;
    if (recCol === -1 && (h === "8502" || h.includes("8502") || h.includes("recover") || h === "rec")) recCol = c;
  }
  if (nameCol === -1) {
    nameCol = header.findIndex((x) => s(x) !== "");
    if (nameCol === -1) nameCol = 0;
  }

  const propCols: { key: string; label: string; name?: string; col: number }[] = [];
  for (let c = 0; c < header.length; c++) {
    if (!isPropCode(header[c])) continue;
    const raw = s(header[c]);
    const key = /^\d+$/.test(raw) ? raw.padStart(4, "0") : raw;
    const propName = s(namesRow[c]);
    propCols.push({ key, label: raw, name: propName || undefined, col: c });
  }

  const properties: Property[] = propCols.map((p) => ({ key: p.key, label: p.label, name: p.name }));

  let startRow = headerRow + 1;
  const nextName = s(rows[startRow]?.[nameCol]);
  const nextLooksLikeNames = !nextName && propCols.some((pc) => !!s(rows[startRow]?.[pc.col]));
  if (nextLooksLikeNames) startRow += 1;

  const employees: AllocationEmployee[] = [];
  for (let r = startRow; r < rows.length; r++) {
    const row = rows[r] || [];
    const empName = s(row[nameCol]);
    if (!empName) continue;

    const allocations: Record<string, number> = {};
    for (const pc of propCols) {
      const p = pctFrom(row[pc.col]);
      if (p > 0) allocations[pc.key] = p;
    }
    if (Object.keys(allocations).length === 0) continue;

    const recoverable = recCol !== -1 ? truthy(row[recCol]) : false;
    employees.push({ name: empName, recoverable, allocations });
  }

  return { properties, employees };
}
