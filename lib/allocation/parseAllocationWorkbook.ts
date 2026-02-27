import * as XLSX from "xlsx";
import { AllocationTable } from "../types";
import { toNumber } from "../utils";

function normPct(v: any): number {
  const n = toNumber(v);
  if (!n) return 0;
  return n > 1 ? n / 100 : n;
}
function cleanKey(s: any): string {
  return String(s ?? "").trim();
}

export function parseAllocationWorkbook(buf: Buffer): AllocationTable {
  const wb = XLSX.read(buf, { type: "buffer" });

  const sheets = wb.SheetNames.map((name) => ({ name, ws: wb.Sheets[name] }));
  const gridOf = (ws: XLSX.WorkSheet) =>
    XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as any[][];

  // Find the allocation input sheet (usually the first / "Sheet1")
  const allocSheet =
    sheets
      .map((s) => ({ ...s, grid: gridOf(s.ws) }))
      .find((s) =>
        s.grid.some((r) =>
          r.some((c) =>
            String(c ?? "").toLowerCase().includes("payroll allocation input")
          )
        )
      ) ??
    sheets
      .map((s) => ({ ...s, grid: gridOf(s.ws) }))
      .find((s) =>
        s.grid.some((r) =>
          r.some((c) =>
            String(c ?? "").toLowerCase().includes("per payroll report")
          )
        )
      ) ??
    sheets
      .map((s) => ({ ...s, grid: gridOf(s.ws) }))
      .find((s) =>
        s.grid.some((r) =>
          r.some((c) => String(c ?? "").trim() === "8502")
        )
      );

  if (!allocSheet) throw new Error("Could not find allocation input sheet");

  const g = allocSheet.grid;

  // Header row for the top allocation table looks like:
  // [ "Per Payroll Report", "LIK", "JV III", "NI LLC", ..., "Total:", 8502, ... ]
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(120, g.length); i++) {
    const row = g[i].map((c) => String(c ?? "").trim());
    const rowLower = row.join(" ").toLowerCase();
    const hasPerPayroll = rowLower.includes("per payroll report");
    const has8502 = row.some((c) => c === "8502" || c.toLowerCase() === "8502");
    const hasProps = row.some((c) =>
      /JV|NI|SC|Marketing|LIK|Office Works|Interstate|Eastwick|Middletown/i.test(c)
    );
    if ((hasPerPayroll || has8502) && hasProps) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1) throw new Error("Could not locate allocation header row");

  const header = g[headerRowIdx].map((c) => String(c ?? "").trim());

  // Identify columns
  const employeeColIdx = 0; // in your workbook, employee names are in col A
  const recColIdx =
    header.findIndex((h) => h === "8502" || /8502/i.test(h) || /recover/i.test(h)) ?? -1;

  // property/group columns are between col 1 and the "Total:" column (exclusive)
  const totalIdx = header.findIndex((h) => /^total:$/i.test(h) || /^total$/i.test(h));
  const lastPctIdx = totalIdx > 0 ? totalIdx : (recColIdx > 0 ? recColIdx : header.length);

  const employees: AllocationTable["employees"] = [];
  for (let r = headerRowIdx + 1; r < g.length; r++) {
    const row = g[r];
    const name = cleanKey(row?.[employeeColIdx]);
    if (!name) continue;
    if (/totals?/i.test(name)) continue;

    // stop when we hit the lower PRS sections (they start with labels like "Salary REC PRS", etc.)
    if (/salary\s*(rec|nr)\s*prs/i.test(name) || /^marketing$/i.test(name)) break;

    const recoverableRaw = recColIdx >= 0 ? row?.[recColIdx] : undefined;
    const recoverable =
      String(recoverableRaw ?? "").toLowerCase() === "true" ||
      String(recoverableRaw ?? "").toLowerCase() === "yes" ||
      recoverableRaw === 1 ||
      recoverableRaw === true;

    const top: Record<string, number> = {};
    for (let c = 1; c < lastPctIdx; c++) {
      const key = header[c];
      if (!key) continue;
      const pct = normPct(row?.[c]);
      if (pct) top[key] = pct;
    }

    employees.push({ name, recoverable, top, marketingToGroups: {} });
  }

  // Helper to locate PRS tables by label in any sheet
  function extractPrs(labelRegex: RegExp) {
    for (const s of sheets) {
      const grid = gridOf(s.ws);
      for (let i = 0; i < grid.length; i++) {
        const rowStr = grid[i].map((c) => String(c ?? "")).join(" ").toLowerCase();
        if (labelRegex.test(rowStr)) {
          // Next row should be header with property columns
          const hdrIdx = i + 1;
          const hdr = (grid[hdrIdx] ?? []).map((c) => String(c ?? "").trim()).filter(Boolean);
          if (hdr.length < 2) continue;

          const table: Record<string, Record<string, number>> = {};
          for (let r = hdrIdx + 1; r < grid.length; r++) {
            const rr = grid[r];
            const rowName = String(rr?.[0] ?? "").trim();
            if (!rowName) break;
            if (/totals?/i.test(rowName)) continue;

            const splits: Record<string, number> = {};
            for (let c = 1; c < hdr.length; c++) {
              const pct = normPct(rr?.[c]);
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

  // Marketing breakdown table (used for Alison's extra step)
  const marketingToGroupsTable = extractPrs(/^marketing$/i);

  for (const emp of employees) {
    const row =
      marketingToGroupsTable[emp.name] ||
      marketingToGroupsTable[emp.name.toUpperCase()] ||
      marketingToGroupsTable[emp.name.toLowerCase()];
    if (row) emp.marketingToGroups = row;
  }

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
