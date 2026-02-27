"use client";

import { useMemo, useState } from "react";
import { money, num, pct as fmtPct } from "../lib/utils";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") return reject(new Error("Unexpected FileReader result"));
      const i = result.indexOf(",");
      if (i === -1) return reject(new Error("Invalid data URL"));
      resolve(result.slice(i + 1));
    };
    reader.readAsDataURL(file);
  });
}

type DrillRow = {
  employee: string;
  amount: number;
  allocPct?: number;
  pct?: number; // backward compat
  baseAmount?: number;
};

type DrillState = {
  title: string;
  total: number;
  rows: DrillRow[];
};

export default function Page() {
  const [payroll, setPayroll] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillState | null>(null);

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
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Failed to parse payroll file");
      setPayroll(json.payroll);
      setInvoices(json.invoices ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to parse payroll file");
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

  function openDrill(inv: any, field: string, label: string) {
    const rows: DrillRow[] = inv?.breakdown?.[field] ?? [];
    const total = inv?.[field] ?? 0;
    const prop = inv?.propertyKey || inv?.propertyLabel || "Property";
    setDrill({
      title: `${prop} — ${label}`,
      total,
      rows: [...rows].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)),
    });
  }

  return (
    <main style={{ display: "grid", gap: 14 }}>
      <header style={{ display: "grid", gap: 6 }}>
        <h1>Payroll Invoicer</h1>
        <p className="muted">
          Import the <b>Payroll Register</b> Excel file (.xls or .xlsx). Allocation is fixed on the backend.
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
          accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
              Summary by property (matches the invoice PDF line items). Rows with $0 will be omitted on PDFs. Click any amount to see employee detail.
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
                    Import a payroll file to see invoice summaries.
                  </td>
                </tr>
              ) : (
                invoices.map((r) => (
                  <tr key={r.propertyKey}>
                    <td>{r.propertyLabel}</td>
                    <td className="clickable" onClick={() => openDrill(r, "salaryREC", "Salary REC")}>{money(r.salaryREC)}</td>
                    <td className="clickable" onClick={() => openDrill(r, "salaryNR", "Salary NR")}>{money(r.salaryNR)}</td>
                    <td className="clickable" onClick={() => openDrill(r, "overtime", "Overtime")}>{money(r.overtime)}</td>
                    <td className="clickable" onClick={() => openDrill(r, "holREC", "HOL REC")}>{money(r.holREC)}</td>
                    <td className="clickable" onClick={() => openDrill(r, "holNR", "HOL NR")}>{money(r.holNR)}</td>
                    <td className="clickable" onClick={() => openDrill(r, "er401k", "401K ER")}>{money(r.er401k)}</td>
                    <td className="clickable" onClick={() => openDrill(r, "total", "Total")}>
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
          Allocation is read from <code>/data/allocation.xlsx</code> on the server (no upload needed).
        </div>
      </div>

      {drill && (
        <div className="modalOverlay" onClick={() => setDrill(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <div className="modalTitle">{drill.title}</div>
                <div className="muted">Total: <b>{money(drill.total)}</b></div>
              </div>
              <button className="btn" onClick={() => setDrill(null)}>Close</button>
            </div>

            <table className="modalTable">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Employee</th>
                  <th style={{ textAlign: "right" }}>Base</th>
                  <th style={{ textAlign: "right" }}>Alloc %</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {drill.rows.map((row, idx) => {
                  const p = row.allocPct ?? row.pct;
                  return (
                    <tr key={idx}>
                      <td>{row.employee}</td>
                      <td style={{ textAlign: "right" }}>{row.baseAmount == null ? "—" : money(row.baseAmount)}</td>
                      <td style={{ textAlign: "right" }}>{p == null ? "—" : fmtPct(p)}</td>
                      <td style={{ textAlign: "right" }}>{money(row.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="muted small" style={{ marginTop: 10 }}>
              Tip: if an employee should not appear here, check their name match + allocation %s.
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
