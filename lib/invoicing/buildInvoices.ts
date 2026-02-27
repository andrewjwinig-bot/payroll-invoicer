import { AllocationTable, PayrollParseResult, PropertyInvoice, InvoiceBreakdown } from "../types";

function sum(obj: Record<string, number>): number {
  return Object.values(obj).reduce((a, b) => a + (b || 0), 0);
}
function normSplits(splits: Record<string, number>): Record<string, number> {
  const t = sum(splits);
  if (!t) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(splits)) out[k] = v / t;
  return out;
}

const GROUPS = ["JV III", "NI LLC", "SC"] as const;

type Acc = {
  salaryREC: number;
  salaryNR: number;
  overtime: number;
  holREC: number;
  holNR: number;
  er401k: number;
};

type AccDetail = Record<keyof Acc, Record<string, number>>; // field -> employee -> amount

function emptyAcc(): Acc {
  return { salaryREC: 0, salaryNR: 0, overtime: 0, holREC: 0, holNR: 0, er401k: 0 };
}
function emptyAccDetail(): AccDetail {
  return {
    salaryREC: {},
    salaryNR: {},
    overtime: {},
    holREC: {},
    holNR: {},
    er401k: {},
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function toBreakdown(detail: AccDetail): InvoiceBreakdown {
  const toRows = (m: Record<string, number>) =>
    Object.entries(m)
      .map(([employee, amount]) => ({ employee, amount: round2(amount) }))
      .filter((r) => Math.abs(r.amount) >= 0.005)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  return {
    salaryREC: toRows(detail.salaryREC),
    salaryNR: toRows(detail.salaryNR),
    overtime: toRows(detail.overtime),
    holREC: toRows(detail.holREC),
    holNR: toRows(detail.holNR),
    er401k: toRows(detail.er401k),
  };
}

export function buildInvoices(payroll: PayrollParseResult, alloc: AllocationTable): PropertyInvoice[] {
  // Map employee name to allocation row
  const empAlloc = new Map<string, AllocationTable["employees"][number]>();
  for (const e of alloc.employees) empAlloc.set(e.name.toLowerCase(), e);

  // Accumulate per property
  const byProp: Record<string, Acc> = {};
  const byPropDetail: Record<string, AccDetail> = {};

  function add(prop: string, field: keyof Acc, amount: number, employeeName: string) {
    if (!amount) return;
    if (!byProp[prop]) byProp[prop] = emptyAcc();
    if (!byPropDetail[prop]) byPropDetail[prop] = emptyAccDetail();
    byProp[prop][field] += amount;
    byPropDetail[prop][field][employeeName] = (byPropDetail[prop][field][employeeName] || 0) + amount;
  }

  for (const emp of payroll.employees) {
    const a = empAlloc.get(emp.name.toLowerCase());
    if (!a) continue;

    // Base top allocations include direct properties + groups + marketing
    const top = a.top || {};

    // 1) direct property allocations (keys that match propertyMeta labels)
    for (const [key, pct] of Object.entries(top)) {
      // Ignore groups and marketing here; handle below
      if (GROUPS.includes(key as any) || key.toLowerCase().includes("marketing")) continue;
      const propLabel = key;
      const salaryField = a.recoverable ? "salaryREC" : "salaryNR";
      add(propLabel, salaryField, emp.salaryAmt * pct, emp.name);
      add(propLabel, "overtime", emp.overtimeAmt * pct, emp.name);
      const holField = a.recoverable ? "holREC" : "holNR";
      add(propLabel, holField, emp.holAmt * pct, emp.name);
      add(propLabel, "er401k", emp.er401kAmt * pct, emp.name);
    }

    // 2) group allocations -> flow through PRS tables depending on recoverability
    for (const group of GROUPS) {
      const pct = top[group] || 0;
      if (!pct) continue;
      const prs = a.recoverable ? alloc.prs.salaryREC : alloc.prs.salaryNR;
      const splits = normSplits(prs[group] || {});
      for (const [prop, sp] of Object.entries(splits)) {
        const salaryField = a.recoverable ? "salaryREC" : "salaryNR";
        const holField = a.recoverable ? "holREC" : "holNR";
        add(prop, salaryField, emp.salaryAmt * pct * sp, emp.name);
        add(prop, "overtime", emp.overtimeAmt * pct * sp, emp.name);
        add(prop, holField, emp.holAmt * pct * sp, emp.name);
        add(prop, "er401k", emp.er401kAmt * pct * sp, emp.name);
      }
    }

    // 3) marketing special: marketing -> groups (per-employee marketingToGroups), then to properties using Salary NR PRS
    const mktPct = Object.entries(top).find(([k]) => k.toLowerCase().includes("marketing"))?.[1] || 0;
    if (mktPct) {
      const m2g = normSplits(a.marketingToGroups || {});
      for (const [group, gp] of Object.entries(m2g)) {
        const prsNR = alloc.prs.salaryNR;
        const splits = normSplits(prsNR[group] || {});
        for (const [prop, sp] of Object.entries(splits)) {
          // marketing always uses Salary NR PRS and allocates salary as NR
          add(prop, "salaryNR", emp.salaryAmt * mktPct * gp * sp, emp.name);
          add(prop, "overtime", emp.overtimeAmt * mktPct * gp * sp, emp.name);
          add(prop, "holNR", emp.holAmt * mktPct * gp * sp, emp.name);
          add(prop, "er401k", emp.er401kAmt * mktPct * gp * sp, emp.name);
        }
      }
    }
  }

  const invoices: PropertyInvoice[] = [];
  for (const [propLabel, acc] of Object.entries(byProp)) {
    const meta = alloc.propertyMeta[propLabel] || { label: propLabel, code: undefined };
    const lines: PropertyInvoice["lines"] = [];
    const pushLine = (description: string, accCode: string, amount: number) => {
      if (!amount || Math.abs(amount) < 0.005) return;
      lines.push({ description, accCode, amount: round2(amount) });
    };

    pushLine("Salary REC", "6030-8502", acc.salaryREC);
    pushLine("Salary NR", "6010-8501", acc.salaryNR);
    pushLine("Overtime", "6030-8502", acc.overtime);
    pushLine("HOL REC", "6010-8501", acc.holREC);
    pushLine("HOL NR", "6030-8502", acc.holNR);
    pushLine("401K ER", "6010-8501", acc.er401k);

    const total = round2(lines.reduce((s, l) => s + l.amount, 0));

    invoices.push({
      propertyKey: meta.code || meta.label,
      propertyLabel: meta.label,
      propertyCode: meta.code,
      payDate: payroll.payDate,
      lines,
      salaryREC: acc.salaryREC,
      salaryNR: acc.salaryNR,
      overtime: acc.overtime,
      holREC: acc.holREC,
      holNR: acc.holNR,
      er401k: acc.er401k,
      total,
      breakdown: byPropDetail[propLabel] ? toBreakdown(byPropDetail[propLabel]) : undefined,
    });
  }

  // stable order
  invoices.sort((a, b) => (a.propertyCode || a.propertyLabel).localeCompare(b.propertyCode || b.propertyLabel));
  return invoices;
}
