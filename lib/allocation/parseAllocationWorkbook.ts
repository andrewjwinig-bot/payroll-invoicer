import * as XLSX from "xlsx";
import { AllocationTable } from "../types";
import { toNumber } from "../utils";

function normPct(v: any): number {
  const n = toNumber(v);
  if (n === 0) return 0;
  return n > 1 ? n / 100 : n;
}
function cleanKey(s: any): string {
  return String(s ?? "").trim();
}

export function parseAllocationWorkbook(buf: Buffer): AllocationTable {
  const wb = XLSX.read(buf, { type: "buffer" });

  // We don't rely on exact sheet names; we scan for key headers.
  // Strategy:
  // - Find a sheet that contains "Payroll Allocation Input" or "Employee" & property columns.
  // - Find PRS tables for Salary REC PRS and Salary NR PRS.
  // - Find Marketing breakdown table.

  const sheets = wb.SheetNames.map((name) => ({ name, ws: wb.Sheets[name] }));

  const gridOf = (ws: XLSX.WorkSheet) => XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as any[][];
  const findSheet = (pred: (grid: any[][]) => boolean) => {
    for (const s of sheets) {
      const g = gridOf(s.ws);
      if (pred(g)) return { ...s, grid: g };
    }
    return null;
  };

  const allocSheet =
    findSheet((g) => g.some((r) => r.some((c) => String(c ?? "").toLowerCase().includes("payroll allocation input")))) ||
    findSheet((g) => g.some((r) => r.includes("Employee") || r.includes("Employee Name")));

  if (!allocSheet) throw new Error("Could not find allocation input sheet");

  const g = allocSheet.grid;

  // Find header row that has "Employee" and at least one property/group column
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(80, g.length); i++) {
    const row = g[i].map((c) => String(c ?? "").trim());
    if (row.some((c) => /^employee/i.test(c)) && row.some((c) => /JV|NI|SC|Marketing|LIK|Office Works|Interstate|Eastwick|Middletown/i.test(c))) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1) throw new Error("Could not locate allocation header row");

  const header = g[headerRowIdx].map((c) => String(c ?? "").trim());
  const colIndex: Record<string, number> = {};
  header.forEach((h, idx) => (colIndex[h] = idx));

  const employeeCol = header.find((h) => /^employee/i.test(h)) ?? header[0];
  const recCol = header.find((h) => /8502|recover/i.test(h)) ?? "8502";

  const employees: AllocationTable["employees"] = [];
  for (let r = headerRowIdx + 1; r < g.length; r++) {
    const row = g[r];
    const name = cleanKey(row[colIndex[employeeCol] ?? 0]);
    if (!name) continue;
    if (/totals?/i.test(name)) continue;

    const recoverableRaw = row[colIndex[recCol] ?? -1];
    const recoverable = String(recoverableRaw ?? "").toLowerCase() === "true" || String(recoverableRaw ?? "").toLowerCase() === "yes" || recoverableRaw === 1;

    const top: Record<string, number> = {};
    for (let c = 0; c < header.length; c++) {
      const key = header[c];
      if (!key || key === employeeCol || key === recCol) continue;
      const v = normPct(row[c]);
      if (v) top[key] = v;
    }

    employees.push({ name, recoverable, top, marketingToGroups: {} });
  }

  // Helper to locate PRS tables by label in sheet(s)
  function extractPrs(labelRegex: RegExp) {
    for (const s of sheets) {
      const grid = gridOf(s.ws);
      for (let i = 0; i < grid.length; i++) {
        const rowStr = grid[i].map((c) => String(c ?? "")).join(" ").toLowerCase();
        if (labelRegex.test(rowStr)) {
          // assume table header is next row with property columns
          const hdrIdx = i + 1;
          const hdr = (grid[hdrIdx] ?? []).map((c) => String(c ?? "").trim()).filter(Boolean);
          if (hdr.length < 2) continue;
          // first col is group/property name, subsequent are property splits
          const table: Record<string, Record<string, number>> = {};
          for (let r = hdrIdx + 1; r < grid.length; r++) {
            const rr = grid[r];
            const rowName = String(rr[0] ?? "").trim();
            if (!rowName) break;
            if (/totals?/i.test(rowName)) continue;
            const splits: Record<string, number> = {};
            for (let c = 1; c < hdr.length; c++) {
              const pct = normPct(rr[c]);
              if (pct) splits[hdr[c]] = pct;
            }
            table[rowName] = splits;
          }
          return table;
        }
      }
    }
    return {} as Record<string, Record<string, number>>;
  }

  const salaryREC = extractPrs(/salary\s*rec\s*prs/i);
  const salaryNR = extractPrs(/salary\s*nr\s*prs/i);

  // Marketing breakdown: Alison marketing -> groups
  const marketingToGroups = extractPrs(/marketing/i);
  // Attach marketingToGroups per employee name if row exists
  for (const emp of employees) {
    const row = marketingToGroups[emp.name] || marketingToGroups[emp.name.toUpperCase()] || marketingToGroups[emp.name.toLowerCase()];
    if (row) emp.marketingToGroups = row;
  }

  // Property metadata mapping
  const propertyMeta: AllocationTable["propertyMeta"] = {};
  const map: Record<string, string | undefined> = {
    "LIK": "2010",
    "Office Works": "4900",
    "Interstate": "0800",
    "Eastwick": "1500",
    "Middletown": undefined,
  };
  Object.entries(map).forEach(([label, code]) => {
    propertyMeta[label] = { label, code };
  });

  return {
    employees,
    prs: { salaryREC, salaryNR },
    propertyMeta,
  };
}
