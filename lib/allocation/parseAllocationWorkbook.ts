import * as XLSX from "xlsx";

export type AllocationEmployee = {
  name: string;
  recoverable8502: boolean;
  // propertyKey -> percent (0..1)
  alloc: Record<string, number>;
};

export type AllocationParseResult = {
  employees: AllocationEmployee[];
  // optional: list of properties we saw
  propertyKeys: string[];
};

// Property labels -> keys used in invoices
const DIRECT_PROPERTY_MAP: Record<string, { key: string; label: string }> = {
  "LIK": { key: "2010", label: "LIK (2010)" },
  "Office Works": { key: "4900", label: "Office Works (4900)" },
  "Interstate": { key: "0800", label: "Interstate (0800)" },
  "Eastwick": { key: "1500", label: "Eastwick (1500)" },
  // Middletown has no number
  "Middeltown": { key: "Middletown", label: "Middletown" },
  "Middletown": { key: "Middletown", label: "Middletown" },
};

function n(v: any): number {
  const num = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(num) ? num : 0;
}
function b(v: any): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "yes" || s === "1" || s === "checked";
}

// Read a rectangular block into rows until blank first col
function readBlock(sheet: XLSX.WorkSheet, startRow: number, startCol: number, width: number, maxRows = 200) {
  const rows: any[][] = [];
  for (let r = startRow; r < startRow + maxRows; r++) {
    const first = XLSX.utils.encode_cell({ r, c: startCol });
    const firstVal = (sheet as any)[first]?.v;
    if (firstVal === undefined || firstVal === null || firstVal === "") break;
    const row: any[] = [];
    for (let c = startCol; c < startCol + width; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      row.push((sheet as any)[addr]?.v ?? null);
    }
    rows.push(row);
  }
  return rows;
}

export function parseAllocationWorkbook(xlsxBuffer: Buffer): AllocationParseResult {
  const wb = XLSX.read(xlsxBuffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("Allocation workbook: missing first sheet");

  // Top table header is row 5 in Excel (0-based row 3) from your file:
  // A: Per Payroll Report, B..J allocations, K total, L 8502
  // We'll locate the header row by finding "Per Payroll Report" in col A
  let headerRow = -1;
  for (let r = 0; r < 30; r++) {
    const a = (sheet as any)[XLSX.utils.encode_cell({ r, c: 0 })]?.v;
    if (String(a ?? "").trim() === "Per Payroll Report") { headerRow = r; break; }
  }
  if (headerRow < 0) throw new Error("Allocation workbook: couldn't find top allocation header row");

  // Read header cells from A..L
  const headers: string[] = [];
  for (let c = 0; c <= 11; c++) {
    const v = (sheet as any)[XLSX.utils.encode_cell({ r: headerRow, c })]?.v;
    headers.push(String(v ?? "").trim());
  }

  const idx = (name: string) => headers.findIndex(h => h.replace(/\s+/g," ").trim() === name);
  const colEmployee = 0;
  const colTotal = headers.findIndex(h => h.toLowerCase().startsWith("total"));
  const col8502 = headers.findIndex(h => String(h).trim() === "8502");

  const colLIK = idx("LIK");
  const colJV = idx("JV III");
  const colNI = headers.findIndex(h => h.toLowerCase().includes("ni llc"));
  const colSC = idx("SC");
  const colOW = idx("Office Works");
  const colMkt = idx("Marketing");
  const colInterstate = idx("Interstate");
  const colMidd = headers.findIndex(h => h.toLowerCase().includes("middel"));
  const colEastwick = idx("Eastwick");

  // Parse PRS tables from below sections by locating section titles
  const findRow = (needle: string) => {
    const range = XLSX.utils.decode_range(sheet["!ref"]!);
    for (let r = 0; r <= range.e.r; r++) {
      const a = (sheet as any)[XLSX.utils.encode_cell({ r, c: 0 })]?.v;
      if (String(a ?? "").trim() === needle) return r;
    }
    return -1;
  };

  // SC table starts with row where A="SC" and then header "Property"
  const scStart = findRow("SC");
  const niStart = findRow("NI LLC ");
  const jvStart = findRow("JV III");
  const mktStart = findRow("Marketing");

  // Build SC prs maps: property -> {rec,nr}
  const scPRS: Record<string, { rec: number; nr: number }> = {};
  if (scStart >= 0) {
    // data rows start 2 rows after "Property" header line (which is scStart+1)
    // We'll scan down until blank property
    for (let r = scStart + 2; r < scStart + 50; r++) {
      const propVal = (sheet as any)[XLSX.utils.encode_cell({ r, c: 0 })]?.v;
      if (propVal === undefined || propVal === null || propVal === "") break;
      const propKey = String(propVal).trim();
      const rec = n((sheet as any)[XLSX.utils.encode_cell({ r, c: 2 })]?.v);
      const nr = n((sheet as any)[XLSX.utils.encode_cell({ r, c: 3 })]?.v);
      scPRS[propKey] = { rec, nr };
    }
  }

  // NI prs maps: building -> {nr,rec} (note column order in your file)
  const niPRS: Record<string, { nr: number; rec: number }> = {};
  if (niStart >= 0) {
    for (let r = niStart + 2; r < niStart + 50; r++) {
      const bld = (sheet as any)[XLSX.utils.encode_cell({ r, c: 0 })]?.v;
      if (bld === undefined || bld === null || bld === "") break;
      const key = String(bld).trim();
      const nr = n((sheet as any)[XLSX.utils.encode_cell({ r, c: 2 })]?.v);
      const rec = n((sheet as any)[XLSX.utils.encode_cell({ r, c: 3 })]?.v);
      niPRS[key] = { nr, rec };
    }
  }

  // JV prs map: building -> pct
  const jvPRS: Record<string, number> = {};
  if (jvStart >= 0) {
    for (let r = jvStart + 2; r < jvStart + 30; r++) {
      const bld = (sheet as any)[XLSX.utils.encode_cell({ r, c: 0 })]?.v;
      if (bld === undefined || bld === null || bld === "") break;
      const key = String(bld).trim();
      const pct = n((sheet as any)[XLSX.utils.encode_cell({ r, c: 2 })]?.v);
      jvPRS[key] = pct;
    }
  }

  // Marketing split table: group -> pct (SC, NI LLC, JV IIII)
  const mktSplit: Record<string, number> = {};
  if (mktStart >= 0) {
    for (let r = mktStart + 1; r < mktStart + 10; r++) {
      const g = (sheet as any)[XLSX.utils.encode_cell({ r, c: 0 })]?.v;
      const pct = (sheet as any)[XLSX.utils.encode_cell({ r, c: 1 })]?.v;
      if (g === undefined || g === null || g === "") break;
      const key = String(g).trim();
      mktSplit[key] = n(pct);
    }
  }

  function applyGroupSC(target: Record<string, number>, groupPct: number, useRec: boolean) {
    for (const [prop, prs] of Object.entries(scPRS)) {
      const p = useRec ? prs.rec : prs.nr;
      if (!p) continue;
      target[prop] = (target[prop] ?? 0) + groupPct * p;
    }
  }
  function applyGroupNI(target: Record<string, number>, groupPct: number, useRec: boolean) {
    for (const [bld, prs] of Object.entries(niPRS)) {
      const p = useRec ? prs.rec : prs.nr;
      if (!p) continue;
      target[bld] = (target[bld] ?? 0) + groupPct * p;
    }
  }
  function applyGroupJV(target: Record<string, number>, groupPct: number) {
    for (const [bld, p] of Object.entries(jvPRS)) {
      if (!p) continue;
      target[bld] = (target[bld] ?? 0) + groupPct * p;
    }
  }

  const employees: AllocationEmployee[] = [];

  // parse employee rows until blank name
  for (let r = headerRow + 1; r < headerRow + 200; r++) {
    const nameVal = (sheet as any)[XLSX.utils.encode_cell({ r, c: colEmployee })]?.v;
    if (!nameVal) break;
    const name = String(nameVal).trim();
    const rec8502 = col8502 >= 0 ? b((sheet as any)[XLSX.utils.encode_cell({ r, c: col8502 })]?.v) : false;

    const alloc: Record<string, number> = {};

    // Direct properties
    const direct = [
      ["LIK", colLIK],
      ["Office Works", colOW],
      ["Interstate", colInterstate],
      ["Middeltown", colMidd],
      ["Eastwick", colEastwick],
    ] as const;

    for (const [label, c] of direct) {
      if (c < 0) continue;
      const pct = n((sheet as any)[XLSX.utils.encode_cell({ r, c })]?.v);
      if (!pct) continue;
      const mapped = DIRECT_PROPERTY_MAP[label];
      if (mapped) alloc[mapped.key] = (alloc[mapped.key] ?? 0) + pct;
    }

    // Groups
    const pctJV = colJV >= 0 ? n((sheet as any)[XLSX.utils.encode_cell({ r, c: colJV })]?.v) : 0;
    const pctNI = colNI >= 0 ? n((sheet as any)[XLSX.utils.encode_cell({ r, c: colNI })]?.v) : 0;
    const pctSC = colSC >= 0 ? n((sheet as any)[XLSX.utils.encode_cell({ r, c: colSC })]?.v) : 0;
    const pctMkt = colMkt >= 0 ? n((sheet as any)[XLSX.utils.encode_cell({ r, c: colMkt })]?.v) : 0;

    if (pctJV) applyGroupJV(alloc, pctJV);
    if (pctNI) applyGroupNI(alloc, pctNI, rec8502); // REC if 8502 else NR
    if (pctSC) applyGroupSC(alloc, pctSC, rec8502); // REC if 8502 else NR

    // Marketing: split to groups then distribute using NR PRS (always NR)
    if (pctMkt) {
      const scShare = mktSplit["SC"] ?? 0;
      const niShare = mktSplit["NI LLC "] ?? mktSplit["NI LLC"] ?? 0;
      const jvShare = mktSplit["JV IIII"] ?? mktSplit["JV III"] ?? 0;

      if (scShare) applyGroupSC(alloc, pctMkt * scShare, false);
      if (niShare) applyGroupNI(alloc, pctMkt * niShare, false);
      if (jvShare) applyGroupJV(alloc, pctMkt * jvShare);
    }

    employees.push({ name, recoverable8502: rec8502, alloc });
  }

  // Collect property keys (as seen from groups + direct)
  const keys = new Set<string>();
  for (const e of employees) for (const k of Object.keys(e.alloc)) keys.add(k);

  return { employees, propertyKeys: Array.from(keys).sort() };
}
