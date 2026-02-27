import * as XLSX from "xlsx";
import { AllocationTable } from "../types";
import { toNumber } from "../utils";

/**
 * Parses the simplified allocation workbook format:
 *   - One sheet (first sheet)
 *   - A header row containing an "Employee" column (e.g. "Employee Name")
 *   - Optional recoverable flag column (e.g. "8502" or "Recoverable" / "REC")
 *   - Property columns as headers (typically property codes like 3610, 2010, etc. OR property names)
 *   - Cells are allocation percentages (either 0–1 or 0–100)
 *
 * Returns AllocationTable:
 *   { properties: [{key,label}], employees: [{name,recoverable,allocations}] }
 */
export function parseAllocationWorkbook(buf: Buffer | ArrayBuffer | Uint8Array): AllocationTable {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Allocation workbook has no sheets.");
  const ws = wb.Sheets[sheetName];

  const grid: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }) as any[][];
  if (!grid.length) throw new Error("Allocation workbook sheet is empty.");

  // Find header row: look for a cell containing "employee" (case-insensitive).
  let headerRowIdx = -1;
  let employeeColIdx = -1;

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      const v = String(row[c] ?? "").trim().toLowerCase();
      if (v.includes("employee")) {
        headerRowIdx = r;
        employeeColIdx = c;
        break;
      }
    }
    if (headerRowIdx >= 0) break;
  }

  if (headerRowIdx < 0) {
    throw new Error("Could not locate allocation header row");
  }

  const header = (grid[headerRowIdx] || []).map((x) => String(x ?? "").trim());

  // Identify recoverable flag column (optional)
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const recoverableColIdx = header.findIndex((h) => {
    const n = norm(h);
    return n === "8502" || n.includes("recoverable") || n === "rec" || n.includes("rec flag") || n.includes("cam");
  });

  // Property columns are everything after employee (+ optional recoverable) that has a non-empty header.
  // We'll keep order as in the sheet.
  const propertyCols: { col: number; key: string; label: string }[] = [];
  for (let c = 0; c < header.length; c++) {
    if (c === employeeColIdx) continue;
    if (c === recoverableColIdx) continue;
    const label = header[c];
    if (!label) continue;

    const key = String(label).trim();
    if (!key) continue;

    propertyCols.push({ col: c, key, label: key });
  }

  if (!propertyCols.length) {
    throw new Error("No property columns found in allocation workbook header row.");
  }

  const properties = propertyCols.map((p) => ({ key: p.key, label: p.label }));

  const employees: AllocationTable["employees"] = [];

  // Read rows below header until we hit a blank employee cell for several rows.
  let blankStreak = 0;
  for (let r = headerRowIdx + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const nameRaw = String(row[employeeColIdx] ?? "").trim();
    if (!nameRaw) {
      blankStreak += 1;
      if (blankStreak >= 5) break; // stop after a few blanks
      continue;
    }
    blankStreak = 0;

    const recoverableVal = recoverableColIdx >= 0 ? row[recoverableColIdx] : "";
    const recoverableStr = String(recoverableVal ?? "").trim().toLowerCase();
    const recoverable =
      recoverableStr === "true" ||
      recoverableStr === "yes" ||
      recoverableStr === "y" ||
      recoverableStr === "1" ||
      recoverableStr === "x" ||
      recoverableStr === "checked";

    const allocations: Record<string, number> = {};

    for (const p of propertyCols) {
      const raw = row[p.col];
      let v = toNumber(raw);
      if (!isFinite(v) || v <= 0) continue;

      // Normalize percent: allow 30 or 30% style numbers; treat > 1 as percent
      if (v > 1) v = v / 100;

      // clamp
      if (v < 0) continue;
      if (v > 1) v = 1;

      // Some spreadsheets store percentages as 0.3 but displayed 30%; that's fine.
      allocations[p.key] = (allocations[p.key] ?? 0) + v;
    }

    employees.push({
      name: nameRaw,
      recoverable,
      allocations,
    });
  }

  if (!employees.length) {
    throw new Error("No employees found in allocation workbook under the header row.");
  }

  return { properties, employees };
}
