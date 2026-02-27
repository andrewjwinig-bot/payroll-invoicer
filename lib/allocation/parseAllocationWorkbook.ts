import * as XLSX from "xlsx";
import { AllocationTable } from "../types";
import { toNumber } from "../utils";

/**
 * Parse the fixed allocation workbook.
 *
 * Supported layout (very flexible):
 * - A header row that includes an employee/name column AND multiple property columns
 * - Property columns can be numeric codes like 3610, 2010, 4900, etc
 * - A recoverable flag column may be named like "8502", "REC", "Recoverable"
 * - Rows below the header contain employee name + allocation %s per property (0..1, 0..100, or "25%")
 */
export function parseAllocationWorkbook(buf: Buffer | ArrayBuffer): AllocationTable {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames?.[0];
  if (!sheetName) throw new Error("Allocation workbook has no sheets");
  const ws = wb.Sheets[sheetName];

  // Read a generous range; we’ll detect the header row heuristically.
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: false, defval: "" }) as any[][];
  if (!rows.length) throw new Error("Allocation workbook is empty");

  // Helpers
  const norm = (v: any) =>
    String(v ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  const isPropHeader = (v: any) => {
    const s = String(v ?? "").trim();
    if (!s) return false;
    // numeric property codes (allow leading zeros)
    if (/^\d{3,6}$/.test(s)) return true;
    // sometimes headers are like "3610 - Korman" or "3610 Korman"
    if (/^\d{3,6}\s*[-–—]\s*\S+/.test(s)) return true;
    if (/^\d{3,6}\s+\S+/.test(s)) return true;
    return false;
  };

  const parsePropKeyLabel = (v: any): { key: string; label: string } | null => {
    const s = String(v ?? "").trim();
    if (!s) return null;
    const m = s.match(/^(\d{3,6})\s*[-–—]?\s*(.*)$/);
    if (!m) return null;
    const key = m[1];
    const rest = (m[2] ?? "").trim();
    const label = rest ? rest : key;
    return { key, label };
  };

  // Find the best header row in the top part of the sheet
  let headerRowIdx = -1;
  let bestScore = -1;

  const scanLimit = Math.min(rows.length, 80);
  for (let r = 0; r < scanLimit; r++) {
    const row = rows[r] ?? [];
    const headers = row.map((c) => String(c ?? "").trim()).filter(Boolean);

    // Count property-like headers
    let propCount = 0;
    for (const c of row) if (isPropHeader(c)) propCount++;

    // Look for an employee/name-ish header
    const hasNameHint = row.some((c) => {
      const s = norm(c);
      return s === "employee" || s === "employee name" || s === "name" || s.includes("employee");
    });

    // Look for a recoverable hint
    const hasRecHint = row.some((c) => {
      const s = norm(c);
      return s.includes("8502") || s === "rec" || s.includes("recoverable");
    });

    // Score: prioritize rows with many property headers. Name hint helps but isn't required.
    const score = propCount * 10 + (hasNameHint ? 15 : 0) + (hasRecHint ? 2 : 0);

    // Require at least 2 property columns; otherwise it's not our table.
    if (propCount >= 2 && score > bestScore) {
      bestScore = score;
      headerRowIdx = r;
    }
  }

  if (headerRowIdx === -1) {
    throw new Error("Could not locate allocation header row");
  }

  const headerRow = rows[headerRowIdx] ?? [];

  // Determine columns
  let nameCol = 0;
  let recCol: number | null = null;

  // Identify name column if we can
  for (let c = 0; c < headerRow.length; c++) {
    const s = norm(headerRow[c]);
    if (s === "employee" || s === "employee name" || s === "name" || s.includes("employee")) {
      nameCol = c;
      break;
    }
  }

  // Identify recoverable column if present
  for (let c = 0; c < headerRow.length; c++) {
    const s = norm(headerRow[c]);
    if (s.includes("8502") || s === "rec" || s.includes("recoverable")) {
      recCol = c;
      break;
    }
  }

  // Identify property columns
  const propCols: { col: number; key: string; label: string }[] = [];
  for (let c = 0; c < headerRow.length; c++) {
    const parsed = parsePropKeyLabel(headerRow[c]);
    if (!parsed) continue;
    // skip if this is clearly the name col
    if (c === nameCol) continue;
    propCols.push({ col: c, key: parsed.key, label: parsed.label });
  }

  // De-dup properties by key (keep first label)
  const propMap = new Map<string, string>();
  for (const p of propCols) {
    if (!propMap.has(p.key)) propMap.set(p.key, p.label);
  }

  const properties = Array.from(propMap.entries()).map(([key, label]) => ({ key, label }));

  const parsePct = (v: any): number => {
    if (v === null || v === undefined) return 0;
    const s0 = String(v).trim();
    if (!s0) return 0;

    // handle percent strings "25%"
    if (s0.endsWith("%")) {
      const n = toNumber(s0.slice(0, -1));
      if (!isFinite(n)) return 0;
      return n / 100;
    }

    const n = toNumber(s0);
    if (!isFinite(n)) return 0;

    // If the sheet stores 25 for 25% or 0.25 for 25%:
    if (n > 1) return n / 100;
    if (n < 0) return 0;
    return n;
  };

  const truthy = (v: any) => {
    const s = norm(v);
    if (!s) return false;
    return s === "true" || s === "yes" || s === "y" || s === "1" || s === "x" || s === "checked";
  };

  const employees: AllocationTable["employees"] = [];

  // Read employee rows until we hit a long run of blanks
  let blankRun = 0;
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const rawName = String(row[nameCol] ?? "").trim();

    if (!rawName) {
      blankRun++;
      if (blankRun >= 10) break;
      continue;
    }
    blankRun = 0;

    const recoverable = recCol !== null ? truthy(row[recCol]) : false;

    const allocations: Record<string, number> = {};
    for (const p of propCols) {
      const pct = parsePct(row[p.col]);
      if (pct && pct > 0) allocations[p.key] = (allocations[p.key] ?? 0) + pct;
    }

    // If allocations are all zeros, still include employee (helps debugging), but they won't contribute.
    employees.push({
      name: rawName,
      recoverable,
      allocations,
      propertyLabels: Object.fromEntries(properties.map((pp) => [pp.key, pp.label])),
    });
  }

  return { properties, employees };
}
