import * as XLSX from "xlsx";
import { AllocationEmployee, AllocationTable, Property } from "../types";

function str(v: any) {
  if (v == null) return "";
  return String(v).trim();
}

function norm(v: any) {
  return str(v).toLowerCase().replace(/\s+/g, " ").trim();
}

function isPropertyHeader(v: any) {
  const s = str(v);
  if (/^\d{3,4}$/.test(s)) return true;
  if (norm(s) === "middletown") return true;
  return false;
}

function pctFromCell(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") {
    if (!isFinite(v) || v <= 0) return 0;
    return v > 1.5 ? v / 100 : v;
  }
  const s = str(v);
  if (!s) return 0;
  if (s.endsWith("%")) {
    const n = parseFloat(s.replace("%", ""));
    return isFinite(n) ? n / 100 : 0;
  }
  const n = Number(s);
  if (!isFinite(n) || n <= 0) return 0;
  return n > 1.5 ? n / 100 : n;
}

function isTruthyCheckbox(v: any): boolean {
  if (v === true) return true;
  if (v === 1) return true;
  const s = norm(v);
  return ["true", "yes", "y", "1", "x", "checked", "☑", "✓"].includes(s);
}

export function parseAllocationWorkbook(buf: Buffer): AllocationTable {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  // raw:true so checkbox booleans come through reliably
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false }) as any[][];

  // Find header row: pick row with most property headers
  let headerRowIdx = -1;
  let bestPropCount = 0;
  for (let r = 0; r < Math.min(rows.length, 250); r++) {
    const row = rows[r] ?? [];
    const propCount = row.filter((c) => isPropertyHeader(c)).length;
    if (propCount >= 2 && propCount > bestPropCount) {
      bestPropCount = propCount;
      headerRowIdx = r;
    }
  }
  if (headerRowIdx === -1) throw new Error("Could not locate allocation header row");

  const header = rows[headerRowIdx] ?? [];
  const maybeNames = rows[headerRowIdx + 1] ?? [];

  // Identify columns
  let nameCol = -1;
  let recoverableCol = -1;

  for (let c = 0; c < header.length; c++) {
    const h = norm(header[c]);
    if (nameCol === -1 && (h.includes("employee") || h === "name" || h.includes("employee name"))) nameCol = c;
    if (recoverableCol === -1 && (h.includes("8502") || h.includes("recover") || h === "rec" || h.includes("cam"))) recoverableCol = c;
  }
  if (nameCol === -1) {
    nameCol = header.findIndex((x) => str(x) !== "");
    if (nameCol === -1) nameCol = 0;
  }

  // Build properties from code row + optional names row beneath it
  const properties: Property[] = [];
  const propCols: { key: string; label: string; name?: string; col: number }[] = [];

  for (let c = 0; c < header.length; c++) {
    if (!isPropertyHeader(header[c])) continue;

    const rawCode = str(header[c]);
    const key = /^\d+$/.test(rawCode) ? rawCode.padStart(4, "0") : rawCode;

    const nameCell = maybeNames?.[c];
    const name = str(nameCell);
    const propName = name && !/^\d{3,4}$/.test(name) ? name : undefined;

    properties.push({ key, label: rawCode, name: propName });
    propCols.push({ key, label: rawCode, name: propName, col: c });
  }

  // If the next row contains property names (and no employee name), skip it
  const nextRowIsNamesRow =
    propCols.some((pc) => !!pc.name) &&
    str(maybeNames?.[nameCol]) === "";

  const startRow = nextRowIsNamesRow ? headerRowIdx + 2 : headerRowIdx + 1;

  const employees: AllocationEmployee[] = [];
  for (let r = startRow; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const name = str(row[nameCol]);
    if (!name) continue;

    const recoverable = recoverableCol !== -1 ? isTruthyCheckbox(row[recoverableCol]) : false;

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
