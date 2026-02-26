import PDFDocument from "pdfkit";
import { PropertyInvoice, PayrollParseResult } from "../types";
import { money } from "../utils";

export type InvoicePdfInput = {
  invoice: PropertyInvoice;
  payroll: PayrollParseResult;
  invoiceNumber: string;
};

const BRAND_BLUE = "#1f4e79";

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  const { invoice, payroll, invoiceNumber } = input;

  const doc = new PDFDocument({ size: "LETTER", margin: 36 });
  const chunks: Buffer[] = [];
  doc.on("data", (d) => chunks.push(d));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // ===== Header =====
  // Left: company + address (matches sample styling)
  doc
    .font("Helvetica-Bold")
    .fontSize(20)
    .fillColor("#000")
    .text("LIK Management Inc", 36, 40, { align: "left" });

  doc
    .font("Helvetica")
    .fontSize(10)
    .text("8 Neshaminy Interplex; Suite 400", 36, 70)
    .text("Trevose, PA  19053", 36, 84);

  // Right: INVOICE label
  doc
    .font("Helvetica")
    .fontSize(34)
    .fillColor(BRAND_BLUE)
    .text("INVOICE", 0, 40, { align: "right" })
    .fillColor("#000");

  // ===== Top info blocks =====
  const pageW = doc.page.width;
  const contentLeft = doc.page.margins.left;
  const contentRight = pageW - doc.page.margins.right;
  const contentW = contentRight - contentLeft;

  const gap = 24;
  const leftW = Math.floor(contentW * 0.46);
  const rightW = contentW - leftW - gap;

  const topY = 125;

  // BILL TO (left)
  drawHeaderBar(doc, contentLeft, topY, leftW, 18, "BILL TO");
  const billBoxY = topY + 22;
  doc.font("Helvetica").fontSize(10).fillColor("#000");

  const billLines = [
    invoice.propertyLabel || "(Property Name)",
    // You can optionally enrich these lines later with property address mapping:
    // "8 Neshaminy Interplex",
    // "Suite 400",
    // "Trevose, PA  19053",
  ];
  drawTextBlock(doc, contentLeft + 6, billBoxY, leftW - 12, billLines);

  // Right block: INVOICE # / DATE + PROPERTY / TERMS
  const rightX = contentLeft + leftW + gap;

  // INVOICE # / DATE header bar
  drawTwoColHeader(doc, rightX, topY, rightW, 18, ["INVOICE #", "DATE"]);

  // values row
  doc.font("Helvetica-Bold").fontSize(10);
  const valY1 = topY + 24;
  drawTwoColValues(doc, rightX, valY1, rightW, [
    invoiceNumber,
    payroll.payDate ?? "—",
  ]);

  // PROPERTY / TERMS header bar
  const topY2 = topY + 58;
  drawTwoColHeader(doc, rightX, topY2, rightW, 18, ["PROPERTY", "TERMS"]);

  // values row
  const valY2 = topY2 + 24;
  doc.font("Helvetica-Bold").fontSize(10);
  drawTwoColValues(doc, rightX, valY2, rightW, [
    invoice.propertyKey ? `(${invoice.propertyKey})` : "(Property Code)",
    "Due upon receipt",
  ]);

  // ===== Line items table =====
  const tableY = 250;
  const tableX = contentLeft;
  const tableW = contentW;

  // Build rows; hide zeros
  const rows: { desc: string; acc: string; amount: number }[] = [];

  const pushIfNonZero = (desc: string, acc: string, amount: number) => {
    if (!amount || Math.abs(amount) < 0.005) return;
    rows.push({ desc, acc, amount });
  };

  pushIfNonZero("Salary REC", "6030-8502", invoice.salaryREC);
  pushIfNonZero("Salary NR", "6010-8501", invoice.salaryNR);
  pushIfNonZero("Overtime", "6030-8502", invoice.overtime);
  pushIfNonZero("HOL REC", "6010-8501", invoice.holREC);
  pushIfNonZero("HOL NR", "6030-8502", invoice.holNR);
  pushIfNonZero("401K ER", "6010-8501", invoice.er401k);

  drawLineItemsTable(doc, tableX, tableY, tableW, rows);

  // ===== Totals section =====
  const afterTableY = tableY + 22 + Math.max(10, rows.length) * 20 + 22;

  // Subtotal line (right aligned)
  doc.font("Helvetica").fontSize(9).fillColor("#000");
  doc.text("SUBTOTAL", contentLeft, afterTableY, { width: tableW - 140, align: "right" });
  doc.text(money(invoice.total), contentLeft, afterTableY, { width: tableW, align: "right" });

  // Tax placeholders to match sample
  doc.text("TAX RATE", contentLeft, afterTableY + 14, { width: tableW - 140, align: "right" });
  doc.text("n/a", contentLeft, afterTableY + 14, { width: tableW, align: "right" });

  doc.text("TAX", contentLeft, afterTableY + 28, { width: tableW - 140, align: "right" });
  doc.text("n/a", contentLeft, afterTableY + 28, { width: tableW, align: "right" });

  // TOTAL blue bar
  const totalBarY = afterTableY + 46;
  const totalBarH = 26;
  doc.save();
  doc.rect(contentLeft, totalBarY, tableW, totalBarH).fill(BRAND_BLUE);
  doc.restore();

  doc.font("Helvetica-Bold").fontSize(14).fillColor("#fff");
  doc.text("TOTAL", contentLeft + 10, totalBarY + 6, { width: 120, align: "left" });
  doc.text("$", contentLeft + 140, totalBarY + 6, { width: 40, align: "left" });
  doc.text(money(invoice.total).replace("$", ""), contentLeft, totalBarY + 6, { width: tableW - 10, align: "right" });
  doc.fillColor("#000");

  // Footer note (small)
  doc.font("Helvetica").fontSize(9).fillColor("#000");
  doc.text("Payable to LIKM4", contentLeft, doc.page.height - 85);

  doc.end();
  return await done;
}

function drawHeaderBar(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, title: string) {
  doc.save();
  doc.rect(x, y, w, h).fill(BRAND_BLUE);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(10).text(title, x + 8, y + 4, { width: w - 16, align: "left" });
  doc.restore();
  doc.fillColor("#000");
}

function drawTextBlock(doc: PDFKit.PDFDocument, x: number, y: number, w: number, lines: string[]) {
  let yy = y;
  doc.font("Helvetica").fontSize(10).fillColor("#000");
  for (const line of lines) {
    doc.text(line, x, yy, { width: w, align: "left" });
    yy += 14;
  }
}

function drawTwoColHeader(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, labels: [string, string]) {
  doc.save();
  doc.rect(x, y, w, h).fill(BRAND_BLUE);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(10);

  const colW = w / 2;
  doc.text(labels[0], x, y + 4, { width: colW, align: "center" });
  doc.text(labels[1], x + colW, y + 4, { width: colW, align: "center" });

  doc.restore();
  doc.fillColor("#000");
}

function drawTwoColValues(doc: PDFKit.PDFDocument, x: number, y: number, w: number, values: [string, string]) {
  const colW = w / 2;
  doc.text(values[0], x, y, { width: colW, align: "center" });
  doc.text(values[1], x + colW, y, { width: colW, align: "center" });
}

function drawLineItemsTable(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  rows: { desc: string; acc: string; amount: number }[],
) {
  const headerH = 18;
  const rowH = 20;

  // Header bar
  doc.save();
  doc.rect(x, y, w, headerH).fill(BRAND_BLUE);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(10);

  const descW = Math.floor(w * 0.55);
  const accW = Math.floor(w * 0.20);
  const amtW = w - descW - accW;

  doc.text("DESCRIPTION", x + 8, y + 4, { width: descW - 16, align: "left" });
  doc.text("ACC CODE", x + descW, y + 4, { width: accW, align: "center" });
  doc.text("AMOUNT", x + descW + accW, y + 4, { width: amtW - 8, align: "right" });

  doc.restore();
  doc.fillColor("#000");

  // Body rows + gridlines
  const startY = y + headerH;
  const maxRows = Math.max(10, rows.length); // keep some blank lines for the same visual feel
  for (let i = 0; i < maxRows; i++) {
    const yy = startY + i * rowH;

    // Horizontal line
    doc.save();
    doc.strokeColor("#bbbbbb").lineWidth(0.5);
    doc.moveTo(x, yy).lineTo(x + w, yy).stroke();
    doc.restore();

    // Vertical separators
    doc.save();
    doc.strokeColor("#bbbbbb").lineWidth(0.5);
    doc.moveTo(x + descW, yy).lineTo(x + descW, yy + rowH).stroke();
    doc.moveTo(x + descW + accW, yy).lineTo(x + descW + accW, yy + rowH).stroke();
    doc.restore();

    if (i < rows.length) {
      const r = rows[i];
      doc.font("Helvetica").fontSize(10).fillColor("#000");
      doc.text(r.desc, x + 8, yy + 5, { width: descW - 16, align: "left" });
      doc.text(r.acc, x + descW, yy + 5, { width: accW, align: "center" });
      doc.text(money(r.amount), x + descW + accW, yy + 5, { width: amtW - 8, align: "right" });
    }
  }

  // Bottom border
  const bottomY = startY + maxRows * rowH;
  doc.save();
  doc.strokeColor(BRAND_BLUE).lineWidth(1);
  doc.moveTo(x, bottomY).lineTo(x + w, bottomY).stroke();
  doc.restore();
}
