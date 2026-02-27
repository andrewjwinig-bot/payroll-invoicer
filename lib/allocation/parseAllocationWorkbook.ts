import * as XLSX from "xlsx";
import { AllocationEmployee, AllocationTable, Property } from "../types";

function asText(v: any): string {
  return String(v ?? "").trim();
}

function readPct(v: any): number {
  if (v == null || v === "" || v === "-" || v === "—") return 0;

  if (typeof v === "number") {
    return v > 1.5 ? v / 100 : v;
  }

  const s = String(v).trim();
  if (s.endsWith("%")) return parseFloat(s.replace("%", "")) / 100;

  const n = Number(s.replace(/[$,]/g, ""));
  if (!isFinite(n)) return 0;

  return n > 1.5 ? n / 100 : n;
}

export function parseAllocationWorkbook(buf: Buffer): AllocationTable {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];

  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as any[][];

  // -------------------------
  // HEADER ROW (ROW 1)
  // -------------------------
  const header = grid[0];

  const propCols: { key: string; col: number }[] = [];
  let recoverableCol = -1;

  for (let c = 0; c < header.length; c++) {
    const h = asText(header[c]);

    if (h === "Recoverable") {
      recoverableCol = c;
      continue;
    }

    if (/^\d{3,4}$/.test(h) || ["40A0","40B0","40C0","Marketing","Eastwick","Middletown"].includes(h)) {
      propCols.push({ key: h, col: c });
    }
  }

  // -------------------------
  // PROPERTY NAME MAPPING
  // -------------------------
  const propertyNameMap: Record<string,string> = {};

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (asText(row?.[0]) === "Property Code" && asText(row?.[1]) === "Property Name") {
      for (let k = r + 1; k < grid.length; k++) {
        const code = asText(grid[k]?.[0]);
        const name = asText(grid[k]?.[1]);
        if (!code) break;
        propertyNameMap[code] = name;
      }
    }
  }

  const properties: Property[] = propCols.map(p => ({
    key: p.key,
    label: p.key,
    name: propertyNameMap[p.key] ?? ""
  }));

  // -------------------------
  // EMPLOYEES
  // -------------------------
  const employees: AllocationEmployee[] = [];

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    const name = asText(row?.[0]);

    if (!name) continue;
    if (name === "Property Code") break;

    const recoverable = asText(row?.[recoverableCol]).toUpperCase() === "REC";

    const allocations: Record<string,number> = {};
    for (const pc of propCols) {
      allocations[pc.key] = readPct(row?.[pc.col]);
    }

    employees.push({ name, recoverable, allocations });
  }

  return { properties, employees };
}
