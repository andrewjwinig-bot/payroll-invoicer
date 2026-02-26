"use client";

import { useMemo, useState } from "react";
import { money, num } from "../lib/utils";

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

export default function Page() {
  const [payroll, setPayroll] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totals = useMemo(() => {
    const t = { salaryREC: 0, salaryNR: 0, overtime: 0, holREC: 0, holNR: 0, er401k: 0, total: 0 };
    for (const i of invoices) {
      t.salaryREC += i.salaryREC ?? 0;
      t.salaryNR += i.salaryNR ?? 0;
      t.overtime += i.overtime ?? 0;
      t.holREC += i.holREC ?? 0;
      t.holNR += i.holNR ?? 0;
      t.er401k += i.er401k ?? 0;
      t.total += i.total ?? 0;
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
      setPayroll(json.payroll);
      setInvoices(json.invoices ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to parse payroll PDF");
      setPayroll(null);
      setInvoices([]);
    } finally {
      setBusy(null);
    }
  }

  async function generateAll() {
    if (!payroll) return;
    setError(null);
    setBusy("Generating PDFs…");
    try {
      const res = await fetch("/api/generate-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payroll }),
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
      <header style={{ display: "grid", gap: 6 }}>
        <h1>Payroll Invoicer</h1>
        <p className="muted">
          Import the <b>Payroll Register</b> PDF. Allocation is fixed on the backend.
        </p>
      </header>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <b>Import Payroll Register</b>
          <span className="muted small">{payroll?.payDate ? `Pay Date: ${payroll.payDate}` : ""}</span>
        </div>

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
            <span className="pill">
              <span className="muted">Salary</span>
              <b>{money(payroll.reportTotals?.salaryTotal ?? 0)}</b>
            </span>

            <span className="pill">
              <span className="muted">Overtime</span>
              <b>{num(payroll.reportTotals?.overtimeHoursTotal ?? 0)} hrs</b>
              <span className="muted small">({money(payroll.reportTotals?.overtimeAmtTotal ?? 0)})</span>
            </span>

            <span className="pill">
              <span className="muted">HOL</span>
              <b>{num(payroll.reportTotals?.holHoursTotal ?? 0)} hrs</b>
              <span className="muted small">({money(payroll.reportTotals?.holAmtTotal ?? 0)})</span>
            </span>

            <span className="pill">
              <span className="muted">401K ER</span>
              <b>{money(payroll.reportTotals?.er401kTotal ?? 0)}</b>
            </span>
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <b>Invoices</b>
            <div className="small muted" style={{ marginTop: 4 }}>
              Summary by property (matches the invoice PDF line items). Rows with $0 will be omitted on PDFs.
            </div>
          </div>
          <button className="btn primary" disabled={!payroll || !!busy} onClick={generateAll}>
            Generate All PDFs
          </button>
        </div>

        {error && <div style={{ marginTop: 10, color: "#b42318", fontWeight: 800 }}>{error}</div>}
        {busy && <div style={{ marginTop: 10, color: "#a15c00", fontWeight: 800 }}>{busy}</div>}

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
                    Import a payroll PDF to see invoice summaries.
                  </td>
                </tr>
              ) : (
                invoices.map((r) => (
                  <tr key={r.propertyKey}>
                    <td>{r.propertyLabel}</td>
                    <td>{money(r.salaryREC)}</td>
                    <td>{money(r.salaryNR)}</td>
                    <td>{money(r.overtime)}</td>
                    <td>{money(r.holREC)}</td>
                    <td>{money(r.holNR)}</td>
                    <td>{money(r.er401k)}</td>
                    <td>
                      <b>{money(r.total)}</b>
                    </td>
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
                <td>{money(totals.holREC)}</td>
                <td>{money(totals.holNR)}</td>
                <td>{money(totals.er401k)}</td>
                <td>{money(totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <hr />
        <div className="small muted">
          Allocation is read from <code>/data/allocation.xlsx</code> on the server (no upload needed). If you update allocations, replace that file in GitHub and redeploy.
        </div>
      </div>
    </main>
  );
}
