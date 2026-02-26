import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { z } from "zod";
import { normalizeWeights } from "../../../lib/utils";
import { AllocationParseResult } from "../../../lib/types";

export const runtime = "nodejs";

const UploadSchema = z.object({
  fileBase64: z.string(),
  filename: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const body = UploadSchema.parse(await req.json());
    const buf = Buffer.from(body.fileBase64, "base64");
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

    const parsed = parseAllocationWorkbook(rows);
    return NextResponse.json(parsed);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Failed to parse allocation workbook" }, { status: 400 });
  }
}

function parseAllocationWorkbook(rows: any[][]): AllocationParseResult {
  // Find top table header row containing "Per Payroll Report"
  const topIdx = rows.findIndex((r) => (r?.[0] ?? "").toString().trim() === "Per Payroll Report");
  if (topIdx < 0) throw new Error("Could not find top allocation table (row starting with 'Per Payroll Report').");

  const header = rows[topIdx].map((x: any) => (x ?? "").toString().trim());
  const totalCol = header.findIndex((h) => /^Total:?$/i.test(h) || /^Total:$/i.test(h));
  if (totalCol < 0) throw new Error("Could not find 'Total' column in top table.");

  // Column with 8502 marker (recoverable checkbox)
  const recCol = header.findIndex((h) => h === "8502" || h === "8502.0" || h === "8502 ");
  if (recCol < 0) throw new Error("Could not find '8502' recoverable column (column L).");

  // property/group columns are between col 1 and totalCol-1
  const topCols = header.slice(1, totalCol);

  // Parse employees until blank name
  const employeesTop: { name: string; recoverable: boolean; topAlloc: Record<string, number> }[] = [];
  for (let i = topIdx + 1; i < rows.length; i++) {
    const name = (rows[i]?.[0] ?? "").toString().trim();
    if (!name) break;
    const recoverable = toBool(rows[i]?.[recCol]);
    const topAlloc: Record<string, number> = {};
    for (let c = 0; c < topCols.length; c++) {
      const colName = topCols[c];
      const v = toNum(rows[i]?.[1 + c]);
      if (v > 0) topAlloc[colName] = v;
    }
    employeesTop.push({ name, recoverable, topAlloc });
  }

  // Parse SC table (Salary REC PRS vs Salary NR Alt PRS)
  const scIdx = rows.findIndex((r) => (r?.[0] ?? "").toString().trim() === "SC");
  if (scIdx < 0) throw new Error("Could not find SC breakout table.");
  const scHeaderRow = rows.findIndex((r, idx) => idx > scIdx && (r?.[0] ?? "").toString().trim() === "Property");
  if (scHeaderRow < 0) throw new Error("Could not find SC header row ('Property').");

  const scRows = readTable(rows, scHeaderRow + 1, 0);
  const scREC: Record<string, number> = {};
  const scNR: Record<string, number> = {};
  for (const r of scRows) {
    const prop = (r[0] ?? "").toString().trim();
    if (!prop) continue;
    scREC[prop] = toNum(r[2]); // PRS
    scNR[prop] = toNum(r[3]);  // Alt PRS
  }

  // Parse NI LLC table: col C = Salary NR PRS, col D = Salary REC PRS
  const niIdx = rows.findIndex((r) => (r?.[0] ?? "").toString().trim().toUpperCase().startsWith("NI LLC"));
  if (niIdx < 0) throw new Error("Could not find NI LLC breakout table.");
  const niHeaderRow = rows.findIndex((r, idx) => idx > niIdx && (r?.[0] ?? "").toString().trim() === "Building");
  if (niHeaderRow < 0) throw new Error("Could not find NI LLC header row ('Building').");

  const niRows = readTable(rows, niHeaderRow + 1, 0);
  const niNR: Record<string, number> = {};
  const niREC: Record<string, number> = {};
  for (const r of niRows) {
    const prop = (r[0] ?? "").toString().trim();
    if (!prop) continue;
    niNR[prop] = toNum(r[2]);
    niREC[prop] = toNum(r[3]);
  }

  // Parse JV III table: col C = PRS
  const jvIdx = rows.findIndex((r) => (r?.[0] ?? "").toString().trim() === "JV III");
  if (jvIdx < 0) throw new Error("Could not find JV III breakout table.");
  const jvHeaderRow = rows.findIndex((r, idx) => idx > jvIdx && (r?.[0] ?? "").toString().trim() === "Building");
  if (jvHeaderRow < 0) throw new Error("Could not find JV III header row ('Building').");

  const jvRows = readTable(rows, jvHeaderRow + 1, 0);
  const jvPRS: Record<string, number> = {};
  for (const r of jvRows) {
    const prop = (r[0] ?? "").toString().trim();
    if (!prop) continue;
    jvPRS[prop] = toNum(r[2]);
  }

  // Parse Marketing breakdown table: rows after "Marketing" contain (Group, pct)
  const mktIdx = rows.findIndex((r) => (r?.[0] ?? "").toString().trim() === "Marketing");
  if (mktIdx < 0) throw new Error("Could not find Marketing breakdown table.");
  const mktGroups: Record<string, number> = {};
  for (let i = mktIdx + 1; i < rows.length; i++) {
    const g = (rows[i]?.[0] ?? "").toString().trim();
    const pct = toNum(rows[i]?.[1]);
    if (!g) break;
    mktGroups[normGroup(g)] = pct;
  }

  // Direct property code mapping from your note
  const directMap: Record<string, { key: string; label: string }> = {
    "LIK": { key: "2010", label: "LIK (2010)" },
    "Office Works": { key: "4900", label: "Office Works (4900)" },
    "Interstate": { key: "0800", label: "Interstate (0800)" },
    "Eastwick": { key: "1500", label: "Eastwick (1500)" },
    "Middeltown": { key: "MIDDLETOWN", label: "Middletown" }, // sheet header misspells it
    "Middletown": { key: "MIDDLETOWN", label: "Middletown" },
  };

  // Collect all property keys/labels discovered
  const propSet = new Map<string, string>();
  for (const v of Object.values(directMap)) propSet.set(v.key, v.label);
  for (const k of Object.keys(scREC)) propSet.set(k, `SC ${k}`);
  for (const k of Object.keys(niNR)) propSet.set(k, `NI LLC ${k}`);
  for (const k of Object.keys(jvPRS)) propSet.set(k, `JV III ${k}`);

  // Build employee weights
  const employees: AllocationParseResult["employees"] = [];
  for (const e of employeesTop) {
    const weights: Record<string, number> = {};

    for (const [col, raw] of Object.entries(e.topAlloc)) {
      const pct = normalizePct(raw);
      if (pct <= 0) continue;
      const c = col.trim();

      if (c in directMap) {
        weights[directMap[c].key] = (weights[directMap[c].key] ?? 0) + pct;
        continue;
      }

      const g = normGroup(c);
      if (g === "SC") {
        const dist = e.recoverable ? scREC : scNR;
        applyDist(weights, dist, pct);
        continue;
      }
      if (g === "NI LLC") {
        const dist = e.recoverable ? niREC : niNR;
        applyDist(weights, dist, pct);
        continue;
      }
      if (g === "JV III") {
        applyDist(weights, jvPRS, pct);
        continue;
      }
      if (g === "MARKETING") {
        // Marketing always flows through Salary NR PRS for its second step
        // First split Marketing across groups using breakdown table
        // Then distribute within each group using the "NR" PRS:
        // - SC uses Alt PRS
        // - NI LLC uses Salary NR PRS
        // - JV III uses PRS
        for (const [mg, mp] of Object.entries(mktGroups)) {
          const sub = pct * normalizePct(mp);
          if (sub <= 0) continue;
          if (mg === "SC") applyDist(weights, scNR, sub);
          else if (mg === "NI LLC") applyDist(weights, niNR, sub);
          else if (mg === "JV III") applyDist(weights, jvPRS, sub);
        }
        continue;
      }

      // Unknown column: ignore but keep parsing
    }

    employees.push({
      name: e.name,
      recoverable: e.recoverable,
      weightsByProperty: normalizeWeights(weights),
    });
  }

  const properties = Array.from(propSet.entries())
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return { properties, employees };
}

function readTable(rows: any[][], startRow: number, keyCol: number): any[][] {
  const out: any[][] = [];
  for (let i = startRow; i < rows.length; i++) {
    const key = rows[i]?.[keyCol];
    if (key === null || key === undefined || (typeof key === "string" && key.trim() === "")) break;
    out.push(rows[i]);
  }
  return out;
}

function applyDist(target: Record<string, number>, dist: Record<string, number>, pct: number) {
  for (const [k, v] of Object.entries(dist)) {
    const w = normalizePct(v);
    if (w <= 0) continue;
    target[k] = (target[k] ?? 0) + pct * w;
  }
}

function normalizePct(v: any): number {
  const n = toNum(v);
  if (!Number.isFinite(n)) return 0;
  // accept 0-1 or 0-100
  return n > 1.000001 ? n / 100 : n;
}

function toNum(v: any): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.trim().replace(/,/g, "");
    const m = s.match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : 0;
  }
  return 0;
}

function toBool(v: any): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "yes" || s === "y" || s === "1" || s === "checked";
  }
  return false;
}

function normGroup(s: string): string {
  const t = s.trim().replace(/\s+/g, " ").toUpperCase();
  if (t.startsWith("NI LLC")) return "NI LLC";
  if (t.startsWith("JV III")) return "JV III";
  if (t.startsWith("JV IIII")) return "JV III";
  if (t === "SC") return "SC";
  if (t === "MARKETING") return "MARKETING";
  return t;
}
