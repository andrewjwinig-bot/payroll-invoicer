import { NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from "pdf-lib";
import fs from "fs";
import path from "path";
import { PROPERTY_DEFS } from "../../../lib/properties/data";

export const runtime = "nodejs";

// ── Page geometry (landscape letter) ─────────────────────────────────────────
const PW = 792;
const PH = 612;
const M  = 36;

// pdf-lib origin is bottom-left; convert from top-left y
function py(topY: number) { return PH - topY; }

// ── Colors ────────────────────────────────────────────────────────────────────
const C_DARK  = rgb(0.059, 0.090, 0.161);
const C_MUTED = rgb(0.42,  0.45,  0.52);
const C_BRAND = rgb(0.043, 0.290, 0.490);
const C_LINE  = rgb(0.88,  0.89,  0.91);
const C_ALT   = rgb(0.975, 0.978, 0.982);
const C_HBKG  = rgb(0.96,  0.97,  0.98);

const KH_CODES = new Set(["9800","9820","9840","9860"]);
const OW_CODES = new Set(["4900"]);

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ── Helpers ───────────────────────────────────────────────────────────────────
function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
function sqftFmt(n: number) { return n.toLocaleString("en-US"); }
function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return s;
  return `${m[1].padStart(2,"0")}/${m[2].padStart(2,"0")}/${m[3].slice(2)}`;
}
function propDisplayName(code: string, fallback: string): string {
  return PROPERTY_DEFS.find(p => p.id.toUpperCase() === code.toUpperCase())?.name ?? fallback;
}
function propAddress(code: string): string | null {
  const def = PROPERTY_DEFS.find(p => p.id.toUpperCase() === code.toUpperCase());
  if (!def) return null;
  return [def.address, def.city, [def.state, def.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}
function parsePeriod(reportFrom: string): string {
  const m = reportFrom?.match(/^(\d{1,2})\/\d+\/(\d{4})$/);
  if (!m) return "";
  return `${MONTHS[parseInt(m[1]) - 1]}-${m[2].slice(2)}`;
}

type ColDef = { header: string; width: number; align: "left" | "right" };

function buildCols(hideNNN: boolean): ColDef[] {
  return hideNNN ? [
    { header: "Tenant",       width: 195, align: "left"  },
    { header: "Unit",         width: 65,  align: "left"  },
    { header: "Sq Ft",        width: 55,  align: "right" },
    { header: "Lease From",   width: 65,  align: "left"  },
    { header: "Lease To",     width: 65,  align: "left"  },
    { header: "Base Rent/mo", width: 80,  align: "right" },
    { header: "Annual $/sf",  width: 60,  align: "right" },
    { header: "Gross/mo",     width: 80,  align: "right" },
  ] : [
    { header: "Tenant",       width: 130, align: "left"  },
    { header: "Unit",         width: 55,  align: "left"  },
    { header: "Sq Ft",        width: 50,  align: "right" },
    { header: "Lease From",   width: 58,  align: "left"  },
    { header: "Lease To",     width: 58,  align: "left"  },
    { header: "Base Rent/mo", width: 65,  align: "right" },
    { header: "Annual $/sf",  width: 52,  align: "right" },
    { header: "CAM/mo",       width: 52,  align: "right" },
    { header: "RET/mo",       width: 52,  align: "right" },
    { header: "Other/mo",     width: 52,  align: "right" },
    { header: "Gross/mo",     width: 65,  align: "right" },
  ];
}

function cellVal(col: string, unit: any): string {
  switch (col) {
    case "Tenant":       return unit.isVacant ? "Vacant" : (unit.occupantName || "");
    case "Unit":         return unit.unitRef || "";
    case "Sq Ft":        return sqftFmt(unit.sqft);
    case "Lease From":   return fmtDate(unit.leaseFrom);
    case "Lease To":     return fmtDate(unit.leaseTo);
    case "Base Rent/mo": return unit.baseRent  ? money(unit.baseRent)  : "—";
    case "Annual $/sf":  return unit.annualRentPerSqft ? `$${unit.annualRentPerSqft.toFixed(2)}` : "—";
    case "CAM/mo":       return unit.opexMonth  ? money(unit.opexMonth)  : "—";
    case "RET/mo":       return unit.reTaxMonth ? money(unit.reTaxMonth) : "—";
    case "Other/mo":     return unit.otherMonth ? money(unit.otherMonth) : "—";
    case "Gross/mo":     return unit.grossRentTotal ? money(unit.grossRentTotal) : "—";
    default:             return "";
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { properties, category, reportFrom } = body as {
      properties: any[];
      category: string;
      reportFrom: string;
    };

    const pdfDoc   = await PDFDocument.create();
    const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const periodStr  = parsePeriod(reportFrom);
    const reportTitle = `${category} — ${periodStr} Status Report`;

    const ROW_H  = 17;
    const HEAD_H = 22;

    // ── Page factory ─────────────────────────────────────────────────────────
    function newPage(): { page: PDFPage; curY: number } {
      const page = pdfDoc.addPage([PW, PH]);
      // top rule
      page.drawLine({ start: { x: M, y: py(M) }, end: { x: PW - M, y: py(M) }, thickness: 2, color: C_BRAND });
      // report title top-right
      const rtW = font.widthOfTextAtSize(reportTitle, 8);
      page.drawText(reportTitle, { x: PW - M - rtW, y: py(M + 14), size: 8, font, color: C_MUTED });
      return { page, curY: M + 22 };
    }

    // ── Draw table header row, return height consumed ────────────────────────
    function drawHeader(page: PDFPage, curY: number, cols: ColDef[], tableX: number, tableW: number) {
      page.drawRectangle({ x: tableX, y: py(curY + HEAD_H), width: tableW, height: HEAD_H, color: C_HBKG });
      page.drawLine({ start: { x: tableX, y: py(curY + HEAD_H) }, end: { x: tableX + tableW, y: py(curY + HEAD_H) }, thickness: 0.75, color: C_LINE });
      let cx = tableX;
      for (const col of cols) {
        const tw = fontBold.widthOfTextAtSize(col.header, 7.5);
        const tx = col.align === "right" ? cx + col.width - 4 - tw : cx + 4;
        page.drawText(col.header, { x: tx, y: py(curY + HEAD_H - 7), size: 7.5, font: fontBold, color: C_DARK });
        cx += col.width;
      }
      return HEAD_H;
    }

    // ── Cover page ────────────────────────────────────────────────────────────
    {
      const { page } = newPage();
      const titleSz = 26;
      const titleW  = fontBold.widthOfTextAtSize(reportTitle, titleSz);
      page.drawText(reportTitle, { x: (PW - titleW) / 2, y: py(200), size: titleSz, font: fontBold, color: C_DARK });

      const now     = new Date();
      const dateStr = `Generated ${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
      const dateW   = font.widthOfTextAtSize(dateStr, 10);
      page.drawText(dateStr, { x: (PW - dateW) / 2, y: py(240), size: 10, font, color: C_MUTED });

      // Summary stat boxes
      const totSqft  = properties.reduce((s: number, p: any) => s + p.totalSqft,    0);
      const totOcc   = properties.reduce((s: number, p: any) => s + p.occupiedSqft, 0);
      const totGross = properties.reduce((s: number, p: any) => s + p.units.reduce((u: number, u2: any) => u + u2.grossRentTotal, 0), 0);
      const occ      = totSqft > 0 ? (totOcc / totSqft) * 100 : 0;

      const stats = [
        { label: "Properties",    value: String(properties.length) },
        { label: "Total Sq Ft",   value: sqftFmt(totSqft)          },
        { label: "Occupancy",     value: `${occ.toFixed(1)}%`      },
        { label: "Gross Rent/mo", value: money(totGross)           },
      ];
      const boxW = 140;
      const boxH = 56;
      const gap  = 12;
      const startX = (PW - (stats.length * boxW + (stats.length - 1) * gap)) / 2;
      stats.forEach((s, i) => {
        const x = startX + i * (boxW + gap);
        const y = py(330);
        page.drawRectangle({ x, y: y - boxH, width: boxW, height: boxH, color: C_HBKG, borderColor: C_LINE, borderWidth: 1 });
        const vw = fontBold.widthOfTextAtSize(s.value, 15);
        page.drawText(s.value, { x: x + (boxW - vw) / 2, y: y - 24, size: 15, font: fontBold, color: C_DARK });
        const lw = font.widthOfTextAtSize(s.label, 9);
        page.drawText(s.label, { x: x + (boxW - lw) / 2, y: y - 41, size: 9, font, color: C_MUTED });
      });
    }

    // ── Per-property sections ─────────────────────────────────────────────────
    for (const prop of properties) {
      const code    = (prop.propertyCode as string).toUpperCase();
      const units   = prop.units as any[];
      const hideNNN = KH_CODES.has(code) || OW_CODES.has(code);
      const cols    = buildCols(hideNNN);
      const tableW  = cols.reduce((s, c) => s + c.width, 0);
      const tableX  = (PW - tableW) / 2;
      const name    = propDisplayName(code, prop.reportedPropertyName || code);
      const address = propAddress(code);

      let { page, curY } = newPage();

      // Property heading
      const nameStr = `${name}`;
      page.drawText(nameStr, { x: M, y: py(curY + 18), size: 16, font: fontBold, color: C_DARK });
      const codeX = M + fontBold.widthOfTextAtSize(nameStr, 16) + 8;
      page.drawText(code, { x: codeX, y: py(curY + 16), size: 10, font, color: C_MUTED });
      curY += 22;

      if (address) {
        page.drawText(address, { x: M, y: py(curY + 12), size: 9, font, color: C_MUTED });
        curY += 16;
      }

      // Stats line
      const occ      = prop.totalSqft > 0 ? (prop.occupiedSqft / prop.totalSqft) * 100 : 0;
      const propGross = units.reduce((s: number, u: any) => s + u.grossRentTotal, 0);
      const statParts = [
        `Occupied: ${sqftFmt(prop.occupiedSqft)} sf`,
        `Vacant: ${sqftFmt(prop.vacantSqft)} sf`,
        `Total: ${sqftFmt(prop.totalSqft)} sf`,
        `Occupancy: ${occ.toFixed(1)}%`,
        ...(propGross > 0 ? [`Gross: ${money(propGross)}/mo`] : []),
      ];
      page.drawText(statParts.join("   ·   "), { x: M, y: py(curY + 11), size: 9, font, color: C_MUTED });
      curY += 16;

      // Rule
      page.drawLine({ start: { x: M, y: py(curY + 2) }, end: { x: PW - M, y: py(curY + 2) }, thickness: 0.5, color: C_LINE });
      curY += 10;

      // Table header
      curY += drawHeader(page, curY, cols, tableX, tableW);

      // Unit rows
      const totSqft  = units.reduce((s: number, u: any) => s + u.sqft,           0);
      const totBase  = units.reduce((s: number, u: any) => s + u.baseRent,        0);
      const totCAM   = units.reduce((s: number, u: any) => s + u.opexMonth,       0);
      const totRET   = units.reduce((s: number, u: any) => s + u.reTaxMonth,      0);
      const totOther = units.reduce((s: number, u: any) => s + u.otherMonth,      0);
      const totGross = units.reduce((s: number, u: any) => s + u.grossRentTotal,  0);
      const avgPerSf = totSqft > 0 ? (totBase * 12) / totSqft : null;

      for (let i = 0; i < units.length; i++) {
        const unit = units[i];

        // Page break check (leave room for totals row)
        if (curY + ROW_H > PH - M - 30) {
          ({ page, curY } = newPage());
          curY += drawHeader(page, curY, cols, tableX, tableW);
        }

        // Alternating bg
        if (i % 2 === 1) {
          page.drawRectangle({ x: tableX, y: py(curY + ROW_H), width: tableW, height: ROW_H, color: C_ALT });
        }

        let cx = tableX;
        for (const col of cols) {
          const val  = cellVal(col.header, unit);
          const fs   = 8;
          const useBold = col.header === "Tenant" && !unit.isVacant;
          const tw   = (useBold ? fontBold : font).widthOfTextAtSize(val, fs);
          const tx   = col.align === "right" ? cx + col.width - 4 - tw : cx + 4;
          page.drawText(val, {
            x: tx, y: py(curY + ROW_H - 5),
            size: fs,
            font: useBold ? fontBold : font,
            color: unit.isVacant ? C_MUTED : C_DARK,
          });
          cx += col.width;
        }
        page.drawLine({ start: { x: tableX, y: py(curY + ROW_H) }, end: { x: tableX + tableW, y: py(curY + ROW_H) }, thickness: 0.2, color: C_LINE });
        curY += ROW_H;
      }

      // Totals row
      if (curY + ROW_H + 4 > PH - M - 10) {
        ({ page, curY } = newPage());
      }
      page.drawLine({ start: { x: tableX, y: py(curY + 1) }, end: { x: tableX + tableW, y: py(curY + 1) }, thickness: 1.5, color: C_DARK });
      page.drawRectangle({ x: tableX, y: py(curY + ROW_H + 1), width: tableW, height: ROW_H, color: C_HBKG });
      const totalVals: Record<string, string> = {
        "Tenant":       "Totals",
        "Sq Ft":        sqftFmt(totSqft),
        "Base Rent/mo": totBase  ? money(totBase)  : "—",
        "Annual $/sf":  avgPerSf ? `$${avgPerSf.toFixed(2)}` : "—",
        "CAM/mo":       totCAM   ? money(totCAM)   : "—",
        "RET/mo":       totRET   ? money(totRET)   : "—",
        "Other/mo":     totOther ? money(totOther) : "—",
        "Gross/mo":     totGross ? money(totGross) : "—",
      };
      let cx2 = tableX;
      for (const col of cols) {
        const val = totalVals[col.header] || "";
        const tw  = fontBold.widthOfTextAtSize(val, 8);
        const tx  = col.align === "right" ? cx2 + col.width - 4 - tw : cx2 + 4;
        page.drawText(val, { x: tx, y: py(curY + ROW_H - 4), size: 8, font: fontBold, color: C_DARK });
        cx2 += col.width;
      }

      // ── Floorplan page ──────────────────────────────────────────────────────
      const fpPath = path.join(process.cwd(), "public", "floorplans", `${code}.jpg`);
      if (fs.existsSync(fpPath)) {
        const imgBytes = fs.readFileSync(fpPath);
        const img      = await pdfDoc.embedJpg(imgBytes);
        const dims     = img.scale(1);

        const { page: fpPage } = newPage();
        fpPage.drawText(`${name} — Floor Plan`, { x: M, y: py(M + 18), size: 13, font: fontBold, color: C_DARK });

        const availW = PW - 2 * M;
        const availH = PH - 2 * M - 36;
        const scale  = Math.min(availW / dims.width, availH / dims.height);
        const drawW  = dims.width  * scale;
        const drawH  = dims.height * scale;
        fpPage.drawImage(img, {
          x: M + (availW - drawW) / 2,
          y: M + 36 + (availH - drawH) / 2,
          width: drawW, height: drawH,
        });
      }
    }

    const pdfBytes  = await pdfDoc.save();
    const safeName  = reportTitle.replace(/[^a-z0-9\-_. ]/gi, "_");

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeName}.pdf"`,
      },
    });
  } catch (err) {
    console.error("Status report error:", err);
    return new NextResponse("Failed to generate report", { status: 500 });
  }
}
