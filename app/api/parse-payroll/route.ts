import { NextResponse } from "next/server";
import { z } from "zod";
import { parsePayrollRegisterExcel } from "../../../lib/payroll/parsePayrollRegisterExcel";
import { parseAllocationWorkbook } from "../../../lib/allocation/parseAllocationWorkbook";
import { buildInvoices } from "../../../lib/invoicing/buildInvoices";
import { readFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

const BodySchema = z.object({
  fileBase64: z.string(),
  filename: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const body = BodySchema.parse(await req.json());
    const buf = Buffer.from(body.fileBase64, "base64");
    const payroll = parsePayrollRegisterExcel(buf);

    const allocationPath = path.join(process.cwd(), "data", "allocation.xlsx");
    const allocBuf = await readFile(allocationPath);
    const allocation = parseAllocationWorkbook(allocBuf);

    const invoices = buildInvoices(payroll as any, allocation as any);

    return NextResponse.json({ payroll, invoices });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Failed to parse payroll file" }, { status: 400 });
  }
}
