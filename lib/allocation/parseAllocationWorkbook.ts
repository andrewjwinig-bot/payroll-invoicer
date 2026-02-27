import * as XLSX from "xlsx";
import { AllocationEmployee, AllocationTable, Property } from "../types";

function str(v: any) {
  if (v == null) return "";
  return String(v).trim();
}

function normHeader(v: any) {
  return str(v).toLowerCase().replace(/\s+/g, " ").trim();
}

function isPropertyCodeHeader(v: any) {
  const s = str(v);
  if (/^\d{3,4}$/.test(s)) return true;
  if (normHeader(s) === "middletown") return true;
  return false;
}

function pctFromCell(v: any): number {
  const s = str(v);
  if (!s) return 0;
  if (s.endsWith("%")) {
    const n = parseFloat(s.replace("%", ""));
    return isFinite(n) ? n / 100 : 0;
  }
  const n = Number(s);
  if (!isFinite(n)) return 0;
  return n > 1.5 ? n / 100 : n;
}

export function parseAllocationWorkbook(buf: Buffer): AllocationTable {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, blankrows: false });

  let headerRowIdx = -1;
  let bestPropCount = 0;
  for (let r = 0; r < Math.min(rows.length, 200); r++) {
    const row = rows[r] ?? [];
    const propCount = row.filter((c) => isPropertyCodeHeader(c)).length;
    if (propCount >= 2 && propCount > bestPropCount) {
      bestPropCount = propCount;
      headerRowIdx = r;
    }
  }
  if (headerRowIdx === -1) throw new Error("Could not locate allocation header row");

  const header = rows[headerRowIdx] ?? [];
  let nameCol = -1;
  let recoverableCol = -1;

  for (let c = 0; c < header.length; c++) {
    const h = normHeader(header[c]);
    if (nameCol === -1 && (h.includes("employee") || h === "name" || h.includes("employee name"))) nameCol = c;
    if (recoverableCol === -1 && (h.includes("8502") || h.includes("recover") || h === "rec" || h.includes("cam"))) recoverableCol = c;
  }
  if (nameCol === -1) {
    nameCol = header.findIndex((x) => str(x) !== "");
    if (nameCol === -1) nameCol = 0;
  }

  const properties: Property[] = [];
  const propCols: { key: string; label: string; col: number }[] = [];
  for (let c = 0; c < header.length; c++) {
    if (!isPropertyCodeHeader(header[c])) continue;
    const raw = str(header[c]);
    const key = /^\d+$/.test(raw) ? raw.padStart(4, "0") : raw;
    properties.push({ key, label: raw });
    propCols.push({ key, label: raw, col: c });
  }

  const employees: AllocationEmployee[] = [];
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const name = str(row[nameCol]);
    if (!name) continue;

    let recoverable = false;
    if (recoverableCol !== -1) {
      const rv = normHeader(row[recoverableCol]);
      recoverable = rv === "true" || rv === "yes" || rv === "y" || rv === "1" || rv === "x" || rv === "checked";
    }

    const allocations: Record<string, number> = {};
    for (const pc of propCols) {
      const p = pctFromCell(row[pc.col]);
      if (p > 0) allocations[pc.key] = p;
    }
    if (Object.keys(allocations).length === 0) continue;
    employees.push({ name, recoverable, allocations });
  }

  return { properties, employees };
}
