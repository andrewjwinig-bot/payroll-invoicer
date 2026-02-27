import * as XLSX from "xlsx";
import { AllocationEmployee, AllocationTable, Property } from "../types";

/**
 * Allocation workbook is formula-heavy. The `xlsx` library does not evaluate formulas.
 * We therefore evaluate a small subset of Excel formulas used in the sheet:
 * - +, -, *, / with parentheses
 * - SUM(A1:B2)
 * - direct cell references (with $)
 *
 * If the workbook has cached results, we will use those instead (cell.v when numeric).
 */

type WS = XLSX.WorkSheet;

function a1(col: number, row: number) {
  return XLSX.utils.encode_cell({ c: col, r: row });
}

function normName(raw: any) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  // remove trailing "Default - #..."
  return s.split("Default")[0].replace(/\s{2,}/g, " ").trim();
}

function isLikelyEmployeeRow(v: any) {
  const s = String(v ?? "").trim();
  if (!s) return false;
  if (s.toLowerCase().includes("per payroll report")) return false;
  // crude: must include a letter
  return /[a-zA-Z]/.test(s);
}

function toNumberMaybe(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  if (s === "-" || s === "—") return 0;
  // percent string
  const pm = s.match(/^(-?\d+(\.\d+)?)\s*%$/);
  if (pm) return parseFloat(pm[1]) / 100;
  // currency/commas
  const cleaned = s.replace(/[$,]/g, "");
  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}

function stripAbs(ref: string) {
  return ref.replace(/\$/g, "");
}

function isCellRef(tok: string) {
  return /^[A-Z]{1,3}\d{1,7}$/i.test(tok);
}

function isRange(tok: string) {
  return /^[A-Z]{1,3}\d{1,7}:[A-Z]{1,3}\d{1,7}$/i.test(tok);
}

// --- Tiny formula evaluator (recursive descent) ---
type Token = { t: string };

function tokenize(expr: string): Token[] {
  const s = expr.replace(/^=/, "").trim();
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[()+\-*/,:]/.test(ch)) { tokens.push({ t: ch }); i++; continue; }
    // letters/numbers/$
    let j = i;
    while (j < s.length && /[A-Za-z0-9.$]/.test(s[j])) j++;
    tokens.push({ t: s.slice(i, j) });
    i = j;
  }
  return tokens;
}

function parseFormula(ws: WS, addr: string, memo: Map<string, number>, visiting: Set<string>, expr: string): number {
  const tokens = tokenize(expr);
  let pos = 0;

  const peek = () => tokens[pos]?.t;
  const eat = (t?: string) => {
    const cur = tokens[pos]?.t;
    if (t && cur !== t) throw new Error(`Expected ${t} got ${cur}`);
    pos++;
    return cur!;
  };

  const evalCell = (ref: string) => {
    const a = stripAbs(ref).toUpperCase();
    return getNumeric(ws, a, memo, visiting);
  };

  const evalRangeSum = (range: string) => {
    const [a, b] = stripAbs(range).toUpperCase().split(":");
    const start = XLSX.utils.decode_cell(a);
    const end = XLSX.utils.decode_cell(b);
    let sum = 0;
    for (let r = start.r; r <= end.r; r++) {
      for (let c = start.c; c <= end.c; c++) {
        sum += getNumeric(ws, XLSX.utils.encode_cell({ r, c }), memo, visiting);
      }
    }
    return sum;
  };

  const parsePrimary = (): number => {
    const t = peek();
    if (t == null) return 0;
    if (t === "(") {
      eat("(");
      const v = parseExpr();
      eat(")");
      return v;
    }
    if (/^SUM$/i.test(t)) {
      eat();
      eat("(");
      // consume everything until ')', expecting one range
      let a = eat();
      if (peek() === ":") { eat(":"); a = `${a}:${eat()}`; }
      eat(")");
      if (!isRange(a)) return 0;
      return evalRangeSum(a);
    }
    // number literal
    const asNum = toNumberMaybe(t);
    if (asNum != null && !isCellRef(stripAbs(t))) {
      eat();
      return asNum;
    }
    // cell ref
    if (isCellRef(stripAbs(t))) {
      eat();
      return evalCell(t);
    }
    // unknown token, skip
    eat();
    return 0;
  };

  const parseMulDiv = (): number => {
    let v = parsePrimary();
    while (peek() === "*" || peek() === "/") {
      const op = eat();
      const rhs = parsePrimary();
      if (op === "*") v = v * rhs;
      else v = rhs === 0 ? 0 : v / rhs;
    }
    return v;
  };

  const parseExpr = (): number => {
    let v = parseMulDiv();
    while (peek() === "+" || peek() === "-") {
      const op = eat();
      const rhs = parseMulDiv();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  };

  const out = parseExpr();
  return out;
}

function getNumeric(ws: WS, addr: string, memo: Map<string, number>, visiting: Set<string>): number {
  const key = addr.toUpperCase();
  if (memo.has(key)) return memo.get(key)!;
  if (visiting.has(key)) return 0; // break cycles
  visiting.add(key);

  const cell: any = (ws as any)[key];
  let v: number | null = null;

  if (cell) {
    v = toNumberMaybe(cell.v);
    if (v == null && typeof cell.w === "string") {
      v = toNumberMaybe(cell.w);
    }
    // evaluate formula if needed
    if (v == null && typeof cell.f === "string") {
      try {
        v = parseFormula(ws, key, memo, visiting, cell.f);
      } catch {
        v = 0;
      }
    }
    if (v == null && typeof cell.v === "string" && String(cell.v).trim().startsWith("=")) {
      try {
        v = parseFormula(ws, key, memo, visiting, cell.v);
      } catch {
        v = 0;
      }
    }
  }

  const out = v ?? 0;
  memo.set(key, out);
  visiting.delete(key);
  return out;
}

function findHeaderRow(grid: any[][]): number {
  // find row with "Per Payroll Report" and many property codes
  let best = -1;
  let bestScore = 0;
  for (let r = 0; r < Math.min(grid.length, 50); r++) {
    const row = grid[r] || [];
    const score =
      row.filter((x) => {
        const s = String(x ?? "").trim();
        return /^\d{3,4}$/.test(s) || s === "Marketing" || s === "Middletown" || s === "Eastwick" || s === "0800";
      }).length;
    if (String(row[0] ?? "").toLowerCase().includes("per payroll report") && score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

function parsePropertyNameMap(grid: any[][]): Record<string, string> {
  // Look for mapping table like:
  // 3610 | Building 1
  // ...
  const map: Record<string, string> = {};
  for (let r = 0; r < grid.length; r++) {
    const a = grid[r]?.[0];
    const b = grid[r]?.[1];
    const key = String(a ?? "").trim();
    const name = String(b ?? "").trim();
    if (!key || !name) continue;
    if (
      (/^\d{3,4}$/.test(key) || key === "Marketing" || key === "0800" || key.toLowerCase().includes("middle") || key.toLowerCase().includes("eastwick") || key === "40A0" || key === "40B0" || key === "40C0")
      && !name.toLowerCase().includes("default")
    ) {
      map[key] = name;
    }
  }
  return map;
}

export function parseAllocationWorkbook(buf: Buffer): AllocationTable {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as any[][];
  const headerIdx = findHeaderRow(grid);
  if (headerIdx < 0) throw new Error("Could not locate allocation header row");

  const header = grid[headerIdx] || [];
  const propCols: { key: string; col: number }[] = [];
  let recoverableCol: number | null = null;

  for (let c = 1; c < header.length; c++) {
    const h = String(header[c] ?? "").trim();
    if (!h) continue;
    if (h === "8502") { recoverableCol = c; continue; }
    if (/^\d{3,4}$/.test(h) || h === "Marketing" || h === "0800" || h === "40A0" || h === "40B0" || h === "40C0" || h.toLowerCase().includes("middle") || h.toLowerCase().includes("eastwick")) {
      propCols.push({ key: h, col: c });
    }
  }

  const propNameMap = parsePropertyNameMap(grid);
  const properties: Property[] = propCols.map((p) => ({
    key: p.key,
    label: p.key,
    name: propNameMap[p.key] || p.key,
  })) as any;

  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  const employees: AllocationEmployee[] = [];

  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    if (!isLikelyEmployeeRow(row[0])) continue;

    const rawName = row[0];
    const name = normName(rawName);
    if (!name) continue;

    // stop if we hit a mapping table (first cell becomes numeric code)
    const first = String(row[0] ?? "").trim();
    if (/^\d{3,4}$/.test(first)) break;

    const recoverable = recoverableCol != null ? Boolean(row[recoverableCol]) : false;

    const allocations: Record<string, number> = {};
    // Use worksheet cell evaluation to compute numeric values even when formulas
    for (const pc of propCols) {
      const addr = a1(pc.col, r); // grid is 0-based, A1 is 0-based -> row r is already 0-based
      const val = getNumeric(ws, addr, memo, visiting);

      // Normalize: if value looks like a percent in 0..100, convert to fraction
      let pct = val;
      if (pct > 1.5 && pct <= 100) pct = pct / 100;
      allocations[pc.key] = pct;
    }

    employees.push({ name, recoverable, allocations });
  }

  if (employees.length === 0) {
    throw new Error("Parsed 0 employees from allocation workbook. Ensure employee names are in column A under the header row.");
  }

  return { properties, employees };
}
