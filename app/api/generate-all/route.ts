import { NextResponse } from "next/server";
import archiver from "archiver";
import { PassThrough } from "stream";
import { z } from "zod";
import { buildInvoices } from "../../../lib/invoicing/buildInvoices";
import { renderInvoicePdf } from "../../../lib/pdf/renderInvoicePdf";
import { parseAllocationWorkbook } from "../../../lib/allocation/parseAllocationWorkbook";
import { readFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

const BodySchema = z.object({
  payroll: z.any(),
});

export async function POST(req: Request) {
  try {
    const body = BodySchema.parse(await req.json());

    // Load fixed allocation workbook from /data/allocation.xlsx
    const allocationPath = path.join(process.cwd(), "data", "allocation.xlsx");
    const allocBuf = await readFile(allocationPath);
    const allocation = parseAllocationWorkbook(allocBuf);

    const invoices = buildInvoices(body.payroll, allocation as any);

    const archive = archiver("zip", { zlib: { level: 9 } });
    const stream = new PassThrough();
    archive.pipe(stream);

    for (const inv of invoices) {
      const pdfBytes = await renderInvoicePdf({
        invoice: inv,
        payroll: body.payroll,
        invoiceNumber: makeInvoiceNumber(),
      });

      const safeName = (inv.propertyLabel || inv.propertyKey || "invoice").replace(
        /[^a-z0-9\-_. ]/gi,
        "_"
      );

      archive.append(Buffer.from(pdfBytes), { name: `${safeName}.pdf` });
    }

    await archive.finalize();

    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const zipBuf = Buffer.concat(chunks);

    return new NextResponse(zipBuf, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=payroll-invoices.zip",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Failed to generate PDFs" },
      { status: 400 }
    );
  }
}

function makeInvoiceNumber() {
  // 8-digit random number, like your sample "RANDOM #"
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}
