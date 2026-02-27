"use client";

import { useMemo, useState } from "react";
import { money, num } from "../lib/utils";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") return reject(new Error("Unexpected FileReader result"));
      const commaIdx = result.indexOf(",");
      if (commaIdx === -1) return reject(new Error("Invalid data URL"));
      resolve(result.slice(commaIdx + 1));
    };
    reader.readAsDataURL(file);
  });
}

type DrillField = "salaryREC" | "salaryNR" | "overtime" | "holREC" | "holNR" | "er401k" | "total";

function fieldLabel(f: DrillField) {
  switch (f) {
    case "salaryREC": return "Salary REC";
    case "salaryNR": return "Salary NR";
    case "overtime": return "Overtime";
    case "holREC": return "HOL REC";
    case "holNR": return "HOL NR";
    case "er401k": return "401K ER";
    case "total": return "Total";
  }
}

export default function Page() {
  const [payroll, setPayroll] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [drill, setDrill] = useState<null | {
    propertyLabel: string;
    propertyKey: string;
    field: DrillField;
    total: number;
    rows: Array<{ employee: string; amount: number; pct?: number }>;
  }>(null);

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

  function openDrill(r: any, field: DrillField) {
    if (!r?.breakdown) return;
    if (field === "total") {
      const merged: Record<string, number> = {};
      const fields: DrillField[] = ["salaryREC", "salaryNR", "overtime", "holREC", "holNR", "er401k"];
      for (const f of fields) {
        const rows = r.breakdown?.[f] || [];
        for (const rr of rows) merged[rr.employee] = (merged[rr.employee] || 0) + (rr.amount || 0);
      }
      const rows = Object.entries(merged)
        .map(([employee, amount]) => ({ employee, amount, pct: undefined }))
        .filter((x) => Math.abs(x.amount) >= 0.005)
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
      setDrill({
        propertyLabel: r.propertyLabel,
        propertyKey: r.propertyKey,
        field,
        total: r.total ?? 0,
        rows,
      });
      return;
    }

    const rowsRaw = r.breakdown?.[field] || [];
    // backend writes allocPct; older patches used pct. Support both.
    const rows = rowsRaw
      .map((rr: any) => ({
        employee: rr.employee,
        amount: rr.amount,
        pct: typeof rr.allocPct === "number" ? rr.allocPct : rr.pct,
      }))
      .filter((x: any) => Math.abs(x.amount || 0) >= 0.005)
      .sort((a: any, b: any) => Math.abs(b.amount) - Math.abs(a.amount));

    setDrill({
      propertyLabel: r.propertyLabel,
      propertyKey: r.propertyKey,
      field,
      total: r[field] ?? 0,
      rows,
    });
  }

  function Cell({ r, field }: { r: any; field: DrillField }) {
    const val = r?.[field] ?? 0;
    const hasRows = field === "total"
      ? true
      : Array.isArray(r?.breakdown?.[field]) && r.breakdown[field].length > 0;

    if (!val || Math.abs(val) < 0.005) return <>{money(0)}</>;

    if (hasRows && r?.breakdown) {
      return (
        <button
          type="button"
          onClick={() => openDrill(r, field)}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
            color: "inherit",
            textDecoration: "underline",
            textUnderlineOffset: 3,
            font: "inherit",
          }}
          title="Click to see employee detail"
        >
          {money(val)}
        </button>
      );
    }

    return <>{money(val)}</>;
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
            <span className="pill"><span className="muted">Salary</span><b>{money(payroll.reportTotals?.salaryTotal ?? 0)}</b></span>
            <span className="pill"><span className="muted">Overtime</span><b>{num(payroll.reportTotals?.overtimeHoursTotal ?? 0)} hrs</b><span className="muted small">({money(payroll.reportTotals?.overtimeAmtTotal ?? 0)})</span></span>
            <span className="pill"><span className="muted">HOL</span><b>{num(payroll.reportTotals?.holHoursTotal ?? 0)} hrs</b><span className="muted small">({money(payroll.reportTotals?.holAmtTotal ?? 0)})</span></span>
            <span className="pill"><span className="muted">401K ER</span><b>{money(payroll.reportTotals?.er401kTotal ?? 0)}</b></span>
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
                  <td colSpan={8} className="muted">Import a payroll file to see invoice summaries.</td>
                </tr>
              ) : (
                invoices.map((r) => (
                  <tr key={r.propertyKey}>
                    <td>{r.propertyLabel}</td>
                    <td><Cell r={r} field="salaryREC" /></td>
                    <td><Cell r={r} field="salaryNR" /></td>
                    <td><Cell r={r} field="overtime" /></td>
                    <td><Cell r={r} field="holREC" /></td>
                    <td><Cell r={r} field="holNR" /></td>
                    <td><Cell r={r} field="er401k" /></td>
                    <td><b><Cell r={r} field="total" /></b></td>
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
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setDrill(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "grid",
            placeItems: "center",
            padding: 16,
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(780px, 100%)",
              background: "white",
              borderRadius: 14,
              border: "1px solid rgba(0,0,0,0.12)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
              padding: 18,
              display: "grid",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 18 }}>
                  {drill.propertyLabel} — {fieldLabel(drill.field)}
                </div>
                <div className="muted small" style={{ marginTop: 4 }}>
                  Total: <b>{money(drill.total)}</b>
                </div>
              </div>
              <button className="btn" onClick={() => setDrill(null)}>Close</button>
            </div>

            <div className="tableWrap" style={{ maxHeight: 420, overflow: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th style={{ textAlign: "right" }}>Alloc %</th>
                    <th style={{ textAlign: "right" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {drill.rows.length === 0 ? (
                    <tr><td colSpan={3} className="muted">No detail rows found.</td></tr>
                  ) : (
                    drill.rows.map((r) => (
                      <tr key={r.employee}>
                        <td>{r.employee}</td>
                        <td style={{ textAlign: "right" }}>{typeof r.pct === "number" ? `${(r.pct * 100).toFixed(2)}%` : "—"}</td>
                        <td style={{ textAlign: "right" }}>{money(r.amount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="muted small">
              Tip: if an employee should not appear here, check their name match + allocation %s.
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
