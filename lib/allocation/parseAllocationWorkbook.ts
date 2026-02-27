import * as XLSX from "xlsx";
import { AllocationTable, Property } from "../types";
import { toNumber } from "../utils";

const GROUPS = ["JV III", "NI LLC", "SC", "Marketing"] as const;

function pctFrom(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") return v > 1.5 ? v / 100 : v; // 25 -> .25, or .25 already
  const s = String(v).trim();
  if (!s || s === "-" || s === "—") return 0;
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return 0;
  const n = Number(m[0]);
  return s.includes("%") || n > 1.5 ? n / 100 : n;
}

/**
 * Reads the allocation workbook from /data/allocation.xlsx.
 *
 * Expected structure:
 * - One header row containing property codes (e.g. 2010, 3610, ..., Marketing, Middletown, Eastwick, 8502)
 * - The cell above/beside may say "Per Payroll Report" (ignored)
 * - Next row may contain property names (optional, but used if present)
 * - Subsequent rows: employee name in first column, percent allocations across columns
 * - A "recoverable" checkbox/flag column labeled "8502" OR a checkbox column near the end.
 *
 * IMPORTANT: If the workbook uses formulas, make sure it is saved with calculated values.
 * The parser reads displayed values (raw:false) so percent-formatted cells work reliably.
 */
export function parseAllocationWorkbook(buffer: Buffer): AllocationTable {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error("Allocation workbook has no sheets");

  // Use raw:false so we get formatted text (and stored formula results when present).
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  }) as any[][];

  // Find the row with the most property-code-looking headers
  let headerRow = -1;
  let bestScore = 0;

  const looksLikePropHeader = (x: any) => {
    const s = String(x ?? "").trim();
    if (!s) return false;
    if (s.toLowerCase().includes("marketing")) return true;
    if (s.toLowerCase().includes("middletown")) return true;
    if (s.toLowerCase().includes("eastwick")) return true;
    return /^\d{3,5}$/.test(s);
  };

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const score = row.reduce((acc, cell) => acc + (looksLikePropHeader(cell) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      headerRow = r;
    }
  }
  if (headerRow < 0 || bestScore < 3) {
    throw new Error("Could not locate allocation header row");
  }

  const header = rows[headerRow] ?? [];

  // Identify which column is the employee name column:
  // prefer a column containing "employee" or "name", else first non-empty column.
  let nameCol = header.findIndex((h) => String(h).toLowerCase().includes("employee") || String(h).toLowerCase().includes("name"));
  if (nameCol < 0) nameCol = header.findIndex((h) => String(h ?? "").trim().length > 0);
  if (nameCol < 0) nameCol = 0;

  // Build property columns
  const propCols: { col: number; key: string; label: string }[] = [];
  for (let c = 0; c < header.length; c++) {
    if (c === nameCol) continue;
    const s = String(header[c] ?? "").trim();
    if (!looksLikePropHeader(s)) continue;

    let key = s;
    let label = s;

    // keep special labels
    if (s.toLowerCase().includes("marketing")) {
      key = "Marketing";
      label = "Marketing";
    }
    if (s.toLowerCase().includes("middletown")) {
      key = "Middletown";
      label = "Middletown";
    }
    if (s.toLowerCase().includes("eastwick")) {
      key = "Eastwick";
      label = "Eastwick";
    }

    propCols.push({ col: c, key, label });
  }

  // Optional property-name row immediately below headerRow
  const maybeNamesRow = rows[headerRow + 1] ?? [];
  const propertyNameByKey: Record<string, string> = {};
  for (const p of propCols) {
    const v = maybeNamesRow[p.col];
    const s = String(v ?? "").trim();
    if (s && s !== "-" && s !== "—") propertyNameByKey[p.key] = s;
  }

  const properties: Property[] = propCols.map((p) => ({
    key: p.key,
    label: p.label,
    name: propertyNameByKey[p.key] || (p.key === p.label ? "" : p.label),
  }));

  // Determine recoverable column (if present). Your sheet uses "8502" checkbox column.
  const recoverableCol = header.findIndex((h) => String(h ?? "").trim() === "8502");

  // Skip the property-name row if it doesn't have an employee name but does have property values.
  let startRow = headerRow + 1;
  const nextName = rows[startRow]?.[nameCol];
  const nextLooksLikeNames =
    !String(nextName ?? "").trim() &&
    propCols.some((p) => {
      const v = rows[startRow]?.[p.col];
      return String(v ?? "").trim() && String(v ?? "").trim() !== "-";
    });
  if (nextLooksLikeNames) startRow += 1;

  const employees: AllocationTable["employees"] = [];

  for (let r = startRow; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const rawName = String(row[nameCol] ?? "").trim();
    if (!rawName) continue;

    // stop if we hit obvious totals/footer
    const lower = rawName.toLowerCase();
    if (lower === "total" || lower.startsWith("total:") || lower.includes("report total")) break;

    const recoverable =
      recoverableCol >= 0
        ? ["true", "1", "yes", "y", "x", "checked"].includes(String(row[recoverableCol] ?? "").trim().toLowerCase())
        : false;

    const allocations: Record<string, number> = {};
    for (const p of propCols) {
      // ignore the recoverable checkbox column (8502) as an allocation target
      if (p.key === "8502") continue;
      const v = row[p.col];
      const pct = pctFrom(v);
      if (pct > 0) allocations[p.key] = pct;
    }

    if (Object.keys(allocations).length === 0) continue;

    employees.push({
      name: rawName,
      recoverable,
      allocations,
    });
  }

  if (employees.length === 0) {
    throw new Error(
      "Allocation workbook parsed 0 employees. If you have formulas, open in Excel and Save so values are stored."
    );
  }

  return { properties, employees };
}
