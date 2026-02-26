"use client";

import { useMemo, useState } from "react";
import { AllocationParseResult, PayrollParseResult, PropertyInvoice } from "../lib/types";
import { buildInvoices } from "../lib/invoicing/buildInvoices";
import { money, num } from "../lib/utils";

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

export default function Page() {
  const [payroll, setPayroll] = useState<PayrollParseResult | null>(null);
  const [allocation, setAllocation] = useState<AllocationParseResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invoices: PropertyInvoice[] = useMemo(() => {
    if (!payroll || !allocation) return [];
    return buildInvoices(payroll, allocation);
  }, [payroll, allocation]);

  const totals = useMemo(() => {
    const t = { salaryREC: 0, salaryNR: 0, overtime: 0, holREC: 0, holNR: 0, er401k: 0, total: 0 };
    for (const i of invoices) {
      t.salaryREC += i.salaryREC;
      t.salaryNR += i.salaryNR;
      t.overtime += i.overtime;
      t.holREC += i.holREC;
      t.holNR += i.holNR;
      t.er401k += i.er401k;
      t.total += i.total;
    }
    return t;
  }, [invoices]);

  async function importPayroll(file: File) {
    setError(null);
    setBusy("Parsing Payroll Register…");
    try {
      const fileBase64 = await fileToBase64(file);
      const res = await fetch("/api/parse-payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64, filename: file.name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to parse payroll PDF");
      setPayroll(json);
    } catch (e: any) {
      setError(e?.message ?? "Failed to parse payroll PDF");
      setPayroll(null);
    } finally {
      setBusy(null);
    }
  }

  async function importAllocation(file: File) {
    setError(null);
    setBusy("Parsing Allocation Workbook…");
    try {
      const fileBase64 = await fileToBase64(file);
      const res = await fetch("/api/parse-allocation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64, filename: file.name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to parse allocation workbook");
      setAllocation(json);
    } catch (e: any) {
      setError(e?.message ?? "Failed to parse allocation workbook");
      setAllocation(null);
    } finally {
      setBusy(null);
    }
  }

  async function generateAll() {
    if (!payroll || !allocation) return;
    setError(null);
    setBusy("Generating PDFs…");
    try {
      const res = await fetch("/api/generate-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payroll, allocation }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? "Failed to generate PDFs");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "payroll-invoices.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message ?? "Failed to generate PDFs");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main style={{ display: "grid", gap: 14 }}>
      <header>
        <h1>Payroll Invoice Generator</h1>
        <p>
          Import your <b>Payroll Register</b> PDF and your <b>employee allocation workbook</b> to generate invoice PDFs per property.
        </p>
      </header>

      <div className="row">
        <div className="card col">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
            <b>1) Import Payroll Register</b>
            <span className="muted small">{payroll?.payDate ? `Pay Date: ${payroll.payDate}` : ""}</span>
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>
            Upload the Payroll Register PDF. We extract Pay Date, employee totals, and Report Total pills.
          </p>
          <input
            className="input"
            type="file"
            accept="application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importPayroll(f);
            }}
          />
          {payroll && (
            <div className="pills">
              <span className="pill"><span className="muted">Salary</span><b>{money(payroll.reportTotals.salaryTotal ?? 0)}</b></span>
              <span className="pill"><span className="muted">Overtime</span><b>{num(payroll.reportTotals.overtimeHoursTotal ?? 0)} hrs</b><span className="muted small">({money(payroll.reportTotals.overtimeAmtTotal ?? 0)})</span></span>
              <span className="pill"><span className="muted">HOL</span><b>{num(payroll.reportTotals.holHoursTotal ?? 0)} hrs</b><span className="muted small">({money(payroll.reportTotals.holAmtTotal ?? 0)})</span></span>
              <span className="pill"><span className="muted">401K ER</span><b>{money(payroll.reportTotals.er401kTotal ?? 0)}</b></span>
            </div>
          )}
        </div>

        <div className="card col">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
            <b>2) Import Allocation Workbook</b>
            <span className="muted small">{allocation ? `${allocation.employees.length} employees` : ""}</span>
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>
            Upload <code>PR for github.xlsx</code>-style allocation workbook (grouped columns + SC/NI/JV breakouts + Marketing breakdown).
          </p>
          <input
            className="input"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importAllocation(f);
            }}
          />
          {allocation && (
            <>
              <div className="pills">
                <span className="pill"><span className="muted">Properties</span><b>{allocation.properties.length}</b></span>
                <span className="pill"><span className="muted">Recoverable rule</span><b>Column “8502”</b></span>
                <span className="pill"><span className="muted">Marketing</span><b>Flows via NR PRS</b></span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <b>Invoices</b>
            <div className="small muted" style={{ marginTop: 4 }}>
              Summary by property (matches line items on each generated invoice PDF).
            </div>
          </div>
          <button className="btn primary" disabled={!payroll || !allocation || !!busy} onClick={generateAll}>
            Generate All PDFs
          </button>
        </div>

        {error && (
          <div style={{ marginTop: 10, color: "#ff8b8b", fontWeight: 700 }}>
            {error}
          </div>
        )}
        {busy && (
          <div style={{ marginTop: 10, color: "#ffd18b", fontWeight: 700 }}>
            {busy}
          </div>
        )}

        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Property</th>
                <th>Salary REC</th>
                <th>Salary NR</th>
                <th>Overtime</th>
                <th>HOL REC</th>
                <th>HOL NR</th>
                <th>401K ER</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted">
                    Import both files to see invoice summaries.
                  </td>
                </tr>
              ) : (
                invoices.map((r) => (
                  <tr key={r.propertyKey}>
                    <td>{r.propertyLabel}</td>
                    <td>{money(r.salaryREC)}</td>
                    <td>{money(r.salaryNR)}</td>
                    <td>{money(r.overtime)}</td>
                    <td>{money(r.holREC)}
                    </td>
                    <td>{money(r.holNR)}</td>
                    <td>{money(r.er401k)}</td>
                    <td><b>{money(r.total)}</b></td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr>
                <td>Totals</td>
                <td>{money(totals.salaryREC)}</td>
                <td>{money(totals.salaryNR)}</td>
                <td>{money(totals.overtime)}</td>
                <td>{money(totals.holREC)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">
                  {money(totals.holNR)}</td>
                <td>{money(totals.er401k)}</td>
                <td>{money(totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <hr />
        <div className="small muted">
          Notes implemented from your allocation sheet:
          <ul>
            <li>Grouped columns <b>JV III</b>, <b>NI LLC</b>, <b>SC</b> distribute to underlying property codes via their PRS tables.</li>
            <li>Column <b>8502</b> decides whether Salary is treated as <b>REC</b> vs <b>NR</b> for that employee.</li>
            <li><b>Marketing</b> first splits across SC / NI LLC / JV III using the Marketing table, then distributes within those groups using <b>Salary NR PRS</b>.</li>
            <li>Direct property code mapping: LIK=2010, Office Works=4900, Interstate=0800, Eastwick=1500, Middletown has no code so it remains name-only.</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
