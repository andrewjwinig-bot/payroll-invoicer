import PDFDocument from "pdfkit";
import { PropertyInvoice, PayrollParseResult } from "../types";

export type InvoicePdfInput = {
  invoice: PropertyInvoice;
  payroll: PayrollParseResult;
  invoiceNumber: string;
};

function money(n: number) {
  const v = Number(n ?? 0);
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  const { invoice, invoiceNumber, payroll } = input;

  const doc = new PDFDocument({ size: "LETTER", margin: 36 });
  const chunks: Buffer[] = [];
  doc.on("data", (d) => chunks.push(d));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const blue = "#0b4a7d";
  const pageW = doc.page.width;
  const left = doc.page.margins.left;
  const right = pageW - doc.page.margins.right;

  // Header left
  doc.fillColor("#000").font("Helvetica-Bold").fontSize(18).text("LIK Management Inc", left, 36);
  doc.font("Helvetica").fontSize(10).text("8 Neshaminy Interplex; Suite 400", left, 60);
  doc.text("Trevose, PA  19053", left, 74);

  // INVOICE title top right
  doc.fillColor(blue).font("Helvetica-Bold").fontSize(32).text("INVOICE", right - 160, 36, { width: 160, align: "right" });

  // Bill To block (left)
  const billY = 110;
  doc.save();
  doc.fillColor(blue).rect(left, billY, 260, 18).fill();
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(9).text("BILL TO", left + 8, billY + 5);
  doc.restore();

  doc.fillColor("#000").font("Helvetica").fontSize(10);
  doc.text(invoice.propertyLabel, left + 8, billY + 28);
  doc.text("8 Neshaminy Interplex", left + 8, billY + 44);
  doc.text("Suite 400", left + 8, billY + 58);
  doc.text("Trevose, PA  19053", left + 8, billY + 72);

  // Right info blocks (invoice #, date, property, terms)
  const infoX = right - 300;
  const infoW = 300;
  const rowH = 18;

  function headerBar(y: number, leftLabel: string, rightLabel: string) {
    doc.save();
    doc.fillColor(blue).rect(infoX, y, infoW, rowH).fill();
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(9);
    doc.text(leftLabel, infoX + 10, y + 5);
    doc.text(rightLabel, infoX + infoW / 2 + 10, y + 5);
    doc.restore();
  }
  headerBar(billY, "INVOICE #", "DATE");
  doc.fillColor("#000").font("Helvetica-Bold").fontSize(10);
  doc.text(invoiceNumber, infoX + 10, billY + rowH + 6);
  doc.text(payroll.payDate ?? "", infoX + infoW / 2 + 10, billY + rowH + 6);

  headerBar(billY + 52, "PROPERTY", "TERMS");
  doc.fillColor("#000").font("Helvetica-Bold").fontSize(10);
  doc.text(invoice.propertyCode ?? invoice.propertyLabel, infoX + 10, billY + 52 + rowH + 6);
  doc.font("Helvetica").text("Due upon receipt", infoX + infoW / 2 + 10, billY + 52 + rowH + 6);

  // Table header
  const tableY = 250;
  const tableW = right - left;
  const colDesc = 260;
  const colAcc = 120;
  const colAmt = tableW - colDesc - colAcc;

  doc.save();
  doc.fillColor(blue).rect(left, tableY, tableW, 20).fill();
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(10);
  doc.text("DESCRIPTION", left + 10, tableY + 6, { width: colDesc - 20 });
  doc.text("ACC CODE", left + colDesc + 10, tableY + 6, { width: colAcc - 20 });
  doc.text("AMOUNT", left + colDesc + colAcc + 10, tableY + 6, { width: colAmt - 20, align: "right" });
  doc.restore();

  // Table rows
  let y = tableY + 28;
  doc.strokeColor("#c8c8c8").lineWidth(0.5);

  for (const line of invoice.lines) {
    doc.fillColor("#000").font("Helvetica").fontSize(10);
    doc.text(line.description, left + 10, y, { width: colDesc - 20 });
    doc.text(line.accCode, left + colDesc + 10, y, { width: colAcc - 20 });
    doc.text(money(line.amount), left + colDesc + colAcc + 10, y, { width: colAmt - 20, align: "right" });

    // row separator
    doc.moveTo(left, y + 16).lineTo(right, y + 16).stroke();
    y += 24;
  }

  // Subtotal/Total footer bar
  const footerY = 660;
  doc.fillColor("#000").font("Helvetica-Bold").fontSize(10).text("Payable to LIKM4", left, footerY);
  doc.fillColor("#000").font("Helvetica").fontSize(10);
  doc.text("SUBTOTAL", right - 240, footerY, { width: 120 });
  doc.text(money(invoice.total), right - 120, footerY, { width: 120, align: "right" });
  doc.text("TAX RATE", right - 240, footerY + 18, { width: 120 });
  doc.text("n/a", right - 120, footerY + 18, { width: 120, align: "right" });
  doc.text("TAX", right - 240, footerY + 36, { width: 120 });
  doc.text("n/a", right - 120, footerY + 36, { width: 120, align: "right" });

  doc.save();
  doc.fillColor(blue).rect(left, 720, tableW, 28).fill();
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(16);
  doc.text("TOTAL", left + 12, 727);
  doc.text(money(invoice.total), right - 200, 727, { width: 190, align: "right" });
  doc.restore();

  doc.end();
  return await done;
}
