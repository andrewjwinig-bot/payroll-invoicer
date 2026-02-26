import { NextResponse } from "next/server";
import archiver from "archiver";
import { PassThrough } from "stream";
import { z } from "zod";
import { buildInvoices } from "../../../lib/invoicing/buildInvoices";
import { renderInvoicePdf } from "../../../lib/pdf/renderInvoicePdf";
import { AllocationParseResult, PayrollParseResult } from "../../../lib/types";

export const runtime = "nodejs";

const Schema = z.object({
  payroll: z.any(),
  allocation: z.any(),
});

export async function POST(req: Request) {
  try {
    const body = Schema.parse(await req.json());
    const payroll = body.payroll as PayrollParseResult;
    const allocation = body.allocation as AllocationParseResult;

    const invoices = buildInvoices(payroll, allocation);

    const filenameSafe = (s: string) =>
      (s ?? "invoice")
        .toString()
        .trim()
        .replace(/[^a-zA-Z0-9\-_. ]+/g, "")
        .replace(/\s+/g, " ")
        .slice(0, 120);

    const archive = archiver("zip", { zlib: { level: 9 } });
    const passthrough = new PassThrough();
    const chunks: Buffer[] = [];
    passthrough.on("data", (c) => chunks.push(Buffer.from(c)));

    const done = new Promise<Buffer>((resolve, reject) => {
      passthrough.on("end", () => resolve(Buffer.concat(chunks)));
      passthrough.on("error", reject);
      archive.on("error", reject);
    });

    archive.pipe(passthrough);

    let idx = 1;
    for (const inv of invoices) {
      const invoiceNumber = `${payroll.payDate ?? "PAYDATE"}-${String(idx).padStart(3, "0")}`;
      const pdf = await renderInvoicePdf({ invoice: inv, payroll, invoiceNumber });
      const fname = `${filenameSafe(inv.propertyLabel)} (${inv.propertyKey}).pdf`;
      archive.append(pdf, { name: fname });
      idx++;
    }

    await archive.finalize();
    const zip = await done;

    return new NextResponse(zip, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="payroll-invoices.zip"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Failed to generate PDFs" }, { status: 400 });
  }
}
