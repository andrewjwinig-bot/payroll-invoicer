import * as XLSX from "xlsx";
import { AllocationEmployee, AllocationTable, Property } from "../types";

type WS = XLSX.WorkSheet;

function asText(v: any): string {
  return String(v ?? "").trim();
}

function isPropHeader(v: any): boolean {
  const s = asText(v);
  if (!s) return false;
  const up = s.toUpperCase();
  if (["MARKETING","MIDDLETOWN","EASTWICK","40A0","40B0","40C0"].includes(up)) return true;
  return /^\d{3,4}$/.test(s);
}

function cellText(ws: WS, r: number, c: number): string {
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell: any = (ws as any)[addr];
  if (!cell) return "";
  if (cell.w != null && String(cell.w).trim() !== "") return String(cell.w).trim();
  if (cell.v != null && String(cell.v).trim() !== "") return String(cell.v).trim();
  return "";
}

function readPct(ws: WS, r: number, c: number): number {
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell: any = (ws as any)[addr];
  if (!cell) return 0;
  if (typeof cell.v === "number") return cell.v > 1.5 ? cell.v / 100 : cell.v;
  const s = asText(cell.w ?? cell.v);
  if (!s || s === "-" || s === "—") return 0;
  if (s.endsWith("%")) return parseFloat(s.replace("%","")) / 100;
  const n = Number(s.replace(/[$,]/g,""));
  if (!isFinite(n)) return 0;
  return n > 1.5 ? n / 100 : n;
}

function findHeaderRow(ws: WS): number {
  const ref = ws["!ref"] as string | undefined;
  const range = ref ? XLSX.utils.decode_range(ref) : { s:{r:0,c:0}, e:{r:200,c:200} };
  let bestRow = -1;
  let bestScore = 0;
  for (let r=0; r<=Math.min(range.e.r,200); r++) {
    let score = 0;
    for (let c=0; c<=Math.min(range.e.c,120); c++) {
      if (isPropHeader(cellText(ws,r,c))) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }
  if (bestScore < 5) throw new Error("Could not locate allocation header row");
  return bestRow;
}

export function parseAllocationWorkbook(buf: Buffer): AllocationTable {
  const wb = XLSX.read(buf, { type:"buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const headerRow = findHeaderRow(ws);

  const propCols: { key:string; col:number }[] = [];
  let recoverableCol: number | null = null;

  for (let c=0; c<200; c++) {
    const h = cellText(ws, headerRow, c);
    if (!h) continue;
    if (h === "8502") { recoverableCol = c; continue; }
    if (isPropHeader(h) && c !== 0) propCols.push({ key:h, col:c });
  }

  const properties: Property[] = propCols.map(p => ({ key:p.key, label:p.key, name:p.key })) as any;

  const employees: AllocationEmployee[] = [];
  for (let r=headerRow+1; r<headerRow+500; r++) {
    const name = cellText(ws,r,0);
    if (!name) continue;
    if (isPropHeader(name)) break;
    const allocations: Record<string,number> = {};
    for (const pc of propCols) {
      allocations[pc.key] = readPct(ws,r,pc.col);
    }
    const recVal = recoverableCol != null ? cellText(ws,r,recoverableCol) : "";
    const recoverable = ["true","1","yes","y","x","✓","☑"].includes(asText(recVal).toLowerCase());
    employees.push({ name, recoverable, allocations });
  }

  return { properties, employees };
}
