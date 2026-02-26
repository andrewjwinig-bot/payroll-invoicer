import { NextResponse } from "next/server";
import { z } from "zod";
import { PayrollParseResult } from "../../../lib/types";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

export const runtime = "nodejs";

const UploadSchema = z.object({
  fileBase64: z.string(),
  filename: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const body = UploadSchema.parse(await req.json());
    const buf = Buffer.from(body.fileBase64, "base64");
    const parsed = await parsePayrollRegisterPdf(buf);
    return NextResponse.json(parsed);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Failed to parse Payroll Register PDF" }, { status: 400 });
  }
}

async function parsePayrollRegisterPdf(pdfBuffer: Buffer): Promise<PayrollParseResult> {
  // pdfjs wants Uint8Array
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(pdfBuffer) });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const strings = content.items.map((it: any) => (it.str ?? "").toString());
    pages.push(strings.join(" "));
  }

  const full = pages.join("\n");

  // Pay Date
  const payDate = matchOne(full, /Pay\s*Date\s*:\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i);

  // Report totals section (best-effort)
  // From your sample PDF: "Report Total: Salary - 5,750.00  Overtime - 280.00  HOL (3.70 HRS) - 167.25  401k (Employer) - 172.50"
  const salaryTotal = matchMoney(full, /Report\s*Total\s*:\s*Salary\s*-\s*([$]?[-0-9,]+\.?[0-9]{0,2})/i);
  const overtimeAmtTotal = matchMoney(full, /Overtime\s*-\s*([$]?[-0-9,]+\.?[0-9]{0,2})/i);
  const holHoursTotal = matchNumber(full, /HOL\s*\(\s*([0-9]+\.?[0-9]*)\s*HRS\s*\)\s*-\s*[$]?[-0-9,]+\.?[0-9]{0,2}/i);
  const holAmtTotal = matchMoney(full, /HOL\s*\(\s*[0-9]+\.?[0-9]*\s*HRS\s*\)\s*-\s*([$]?[-0-9,]+\.?[0-9]{0,2})/i);
  const er401kTotal = matchMoney(full, /401k\s*\(\s*Employer\s*\)\s*-\s*([$]?[-0-9,]+\.?[0-9]{0,2})/i);

  // Employee blocks parsing:
  // Sample layout includes lines like:
  // "Winig, Drew Salary - 1,437.50 Overtime - 0.00 HOL (0.00 HRS) - 0.00 401k (Employer) - 43.13"
  // We'll parse by scanning for "Last, First" patterns and capturing nearby amounts.
  const employees: any[] = [];
  const re = /([A-Z][a-zA-Z'\-]+,\s*[A-Z][a-zA-Z'\-\. ]+)\s+Salary\s*-\s*([$]?[-0-9,]+\.?[0-9]{0,2})\s+Overtime\s*-\s*([$]?[-0-9,]+\.?[0-9]{0,2})\s+HOL\s*\(\s*([0-9]+\.?[0-9]*)\s*HRS\s*\)\s*-\s*([$]?[-0-9,]+\.?[0-9]{0,2})\s+401k\s*\(\s*Employer\s*\)\s*-\s*([$]?[-0-9,]+\.?[0-9]{0,2})/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(full)) !== null) {
    const name = m[1].trim();
    employees.push({
      name,
      salaryAmt: toMoney(m[2]),
      overtimeAmt: toMoney(m[3]),
      holHours: toNum(m[4]),
      holAmt: toMoney(m[5]),
      er401kAmt: toMoney(m[6]),
    });
  }

  // Fallback: if regex finds nothing, return empty employees with totals
  const out: PayrollParseResult = {
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
  };
  return out;
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
  if (typeof v === "number") return v;
  const s = (v ?? "").toString().replace(/[$,]/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function toNum(v: any): number {
  const s = (v ?? "").toString().replace(/,/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
