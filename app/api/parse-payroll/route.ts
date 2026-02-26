import { NextResponse } from "next/server";
import { z } from "zod";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildInvoices } from "../../../lib/invoicing/buildInvoices";
import { parseAllocationWorkbook } from "../../../lib/allocation/parseAllocationWorkbook";
import type { PayrollParseResult } from "../../../lib/types";
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
    const pdfBuf = Buffer.from(body.fileBase64, "base64");
    const payroll = await parsePayrollRegisterPdf(pdfBuf);

    // Load fixed allocation workbook from /data/allocation.xlsx
    const allocationPath = path.join(process.cwd(), "data", "allocation.xlsx");
    const allocBuf = await readFile(allocationPath);
    const allocation = parseAllocationWorkbook(allocBuf);

    const invoices = buildInvoices(payroll as any, allocation as any);

    return NextResponse.json({ payroll, invoices });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Failed to parse payroll" }, { status: 400 });
  }
}

async function parsePayrollRegisterPdf(pdfBuffer: Buffer): Promise<PayrollParseResult> {
  // Disable the pdf.js worker so it runs in-process on Vercel/Next serverless builds.
  // This avoids: "Setting up fake worker failed: Cannot find module .../pdf.worker.mjs"
  const loadingTask = (pdfjs as any).getDocument({
    data: new Uint8Array(pdfBuffer),
    disableWorker: true,
  });

  const pdf = await loadingTask.promise;

  const pages: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const strings = (content.items as any[]).map((it: any) => (it.str ?? "").toString());
    pages.push(strings.join(" "));
  }
  const full = pages.join("\n");

  const payDate = matchOne(full, /Pay\s*Date\s*:\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i);

  const salaryTotal = matchMoney(full, /Report\s*Total\s*:\s*Salary\s*-\s*([$]?[-0-9,]+\.?[0-9]{0,2})/i);
  const overtimeAmtTotal = matchMoney(full, /Overtime\s*-\s*([$]?[-0-9,]+\.?[0-9]{0,2})/i);
  const holHoursTotal = matchNumber(full, /HOL\s*\(\s*([0-9]+\.?[0-9]*)\s*HRS\s*\)\s*-\s*[$]?[-0-9,]+\.?[0-9]{0,2}/i);
  const holAmtTotal = matchMoney(full, /HOL\s*\(\s*[0-9]+\.?[0-9]*\s*HRS\s*\)\s*-\s*([$]?[-0-9,]+\.?[0-9]{0,2})/i);
  const er401kTotal = matchMoney(full, /401k\s*\(\s*Employer\s*\)\s*-\s*([$]?[-0-9,]+\.?[0-9]{0,2})/i);

  const employees: any[] = [];
  const re = /([A-Z][a-zA-Z'\-]+,\s*[A-Z][a-zA-Z'\-\. ]+)\s+Salary\s*-\s*([$]?[-0-9,]+\.?[0-9]{0,2})\s+Overtime\s*-\s*([$]?[-0-9,]+\.?[0-9]{0,2})\s+HOL\s*\(\s*([0-9]+\.?[0-9]*)\s*HRS\s*\)\s*-\s*([$]?[-0-9,]+\.?[0-9]{0,2})\s+401k\s*\(\s*Employer\s*\)\s*-\s*([$]?[-0-9,]+\.?[0-9]{0,2})/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(full)) !== null) {
    employees.push({
      name: m[1].trim(),
      salaryAmt: toMoney(m[2]),
      overtimeAmt: toMoney(m[3]),
      holHours: toNum(m[4]),
      holAmt: toMoney(m[5]),
      er401kAmt: toMoney(m[6]),
    });
  }

  return {
    payDate: payDate ?? undefined,
    reportTotals: {
      salaryTotal: salaryTotal ?? undefined,
      overtimeAmtTotal: overtimeAmtTotal ?? undefined,
      overtimeHoursTotal: undefined,
      holAmtTotal: holAmtTotal ?? undefined,
      holHoursTotal: holHoursTotal ?? undefined,
      er401kTotal: er401kTotal ?? undefined,
    },
    employees,
  } as any;
}

function matchOne(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  return m?.[1]?.toString();
}
function matchMoney(text: string, re: RegExp): number | undefined {
  const m = text.match(re);
  if (!m?.[1]) return undefined;
  return toMoney(m[1]);
}
function matchNumber(text: string, re: RegExp): number | undefined {
  const m = text.match(re);
  if (!m?.[1]) return undefined;
  return toNum(m[1]);
}
function toMoney(v: any): number {
  const s = (v ?? "").toString().replace(/[$,]/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function toNum(v: any): number {
  const s = (v ?? "").toString().replace(/,/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
