import * as XLSX from "xlsx";
import { AllocationTable } from "../types";
import { toNumber } from "../utils";

/**
 * Parses allocation workbook (simplified table):
 * - First sheet
 * - One header row with a Name/Employee column
 * - Optional recoverable flag column (8502 / Recoverable / REC)
 * - Property columns as headers (often numeric codes like 3610, 2010, etc.)
 * - Cells are allocation percentages (0–1 or 0–100)
 *
 * Returns:
 *   { properties: [{key,label}], employees: [{name,recoverable,allocations}] }
 */
export function parseAllocationWorkbook(buf: Buffer | ArrayBuffer | Uint8Array): AllocationTable {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Allocation workbook has no sheets.");
  const ws = wb.Sheets[sheetName];

  const grid: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }) as any[][];
  if (!grid.length) throw new Error("Allocation workbook sheet is empty.");

  const norm = (s: string) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const isPropHeader = (h: string) => {
    const t = String(h ?? "").trim();
    if (!t) return false;
    // Common property code pattern (3–5 digits, may have leading zeros)
    if (/^\d{3,5}$/.test(t)) return true;
    // Also allow codes like "0800"
    if (/^\d{2,5}$/.test(t) && /\d/.test(t)) return true;
    // Allow a few known named properties (if someone uses labels instead of codes)
    const n = norm(t);
    if (["middletown", "office works", "interstate", "eastwick", "lik"].includes(n)) return true;
    return false;
  };

  // Find header row: prefer a row that contains a Name/Employee column AND at least 2 property columns.
  let headerRowIdx = -1;
  let employeeColIdx = -1;
  let bestScore = -1;

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    const header = row.map((x) => String(x ?? "").trim());
    if (!header.some((h) => h)) continue;

    // Find employee/name column
    let nameCol = -1;
    for (let c = 0; c < header.length; c++) {
      const v = norm(header[c]);
      if (v.includes("employee") || v === "name" || v.includes("employee name") || v.includes("ee name")) {
        nameCol = c;
        break;
      }
    }
    if (nameCol < 0) continue;

    // Optional recoverable column
    const recCol = header.findIndex((h) => {
      const v = norm(h);
      return v === "8502" || v.includes("recoverable") || v === "rec" || v.includes("rec flag") || v.includes("cam");
    });

    // Count property headers
    let propCount = 0;
    for (let c = 0; c < header.length; c++) {
      if (c === nameCol) continue;
      if (c === recCol) continue;
      if (isPropHeader(header[c])) propCount++;
    }

    // Score: property count, with a slight boost if header contains "employee"
    const score = propCount + (norm(header[nameCol]).includes("employee") ? 0.25 : 0);
    if (propCount >= 2 && score > bestScore) {
      bestScore = score;
      headerRowIdx = r;
      employeeColIdx = nameCol;
    }
  }

  if (headerRowIdx < 0) {
    // Fallback: find any row that contains "employee" anywhere (legacy behavior)
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r] || [];
      for (let c = 0; c < row.length; c++) {
        const v = norm(row[c]);
        if (v.includes("employee")) {
          headerRowIdx = r;
          employeeColIdx = c;
          break;
        }
      }
      if (headerRowIdx >= 0) break;
    }
  }

  if (headerRowIdx < 0) {
    throw new Error("Could not locate allocation header row");
  }

  const header = (grid[headerRowIdx] || []).map((x) => String(x ?? "").trim());

  // Identify recoverable flag column (optional)
  const recoverableColIdx = header.findIndex((h) => {
    const n = norm(h);
    return n === "8502" || n.includes("recoverable") || n === "rec" || n.includes("rec flag") || n.includes("cam");
  });

  // Property columns are everything except employee (+ optional recoverable) that has a non-empty header.
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
      if (blankStreak >= 5) break;
      continue;
    }
    blankStreak = 0;

    const recoverableVal = recoverableColIdx >= 0 ? row[recoverableColIdx] : "";
    const recoverableStr = norm(recoverableVal);
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

      if (v <= 0) continue;
      if (v > 1) v = 1;

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
