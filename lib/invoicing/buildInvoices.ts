import { AllocationTable, PayrollParseResult, PropertyInvoice, Contribution, InvoiceLineKey } from "../types";

function normName(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lastNameKey(s: string) {
  const n = normName(s);
  const parts = n.split(" ").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : n;
}

function pickPct(raw: number): number {
  if (!isFinite(raw) || raw <= 0) return 0;
  return raw > 1.5 ? raw / 100 : raw;
}

export function buildInvoices(payroll: PayrollParseResult, allocation: AllocationTable): PropertyInvoice[] {
  const props = allocation.properties?.length
    ? allocation.properties
    : (() => {
        const set = new Set<string>();
        for (const e of allocation.employees ?? []) for (const k of Object.keys(e.allocations ?? {})) set.add(k);
        return [...set].sort().map((k) => ({ key: k, label: k }));
      })();

  const invByKey = new Map<string, PropertyInvoice>();
  for (const p of props as any[]) {
    invByKey.set(p.key, {
      propertyKey: p.key,
      propertyLabel: p.label,
      propertyName: p.name,
      salaryREC: 0,
      salaryNR: 0,
      overtime: 0,
      holREC: 0,
      holNR: 0,
      er401k: 0,
      total: 0,
      breakdown: {},
    });
  }

  const byFull = new Map<string, { recoverable: boolean; allocations: Record<string, number>; name: string }>();
  const byLast = new Map<string, { recoverable: boolean; allocations: Record<string, number>; name: string }[]>();
  for (const ae of allocation.employees ?? []) {
    const full = normName(ae.name);
    const entry = { recoverable: !!ae.recoverable, allocations: ae.allocations ?? {}, name: ae.name };
    byFull.set(full, entry);
    const ln = lastNameKey(ae.name);
    byLast.set(ln, [...(byLast.get(ln) ?? []), entry]);
  }

  function findAlloc(empName: string) {
    const full = normName(empName);
    const direct = byFull.get(full);
    if (direct) return direct;
    const ln = lastNameKey(empName);
    const candidates = byLast.get(ln) ?? [];
    if (candidates.length === 1) return candidates[0];
    if (candidates.length) {
      return candidates
        .slice()
        .sort((a, b) => Object.keys(b.allocations).length - Object.keys(a.allocations).length)[0];
    }
    return null;
  }

  function add(propKey: string, line: InvoiceLineKey, amount: number, employee: string, allocPct?: number, baseAmount?: number) {
    if (!amount || Math.abs(amount) < 0.00001) return;
    const inv = invByKey.get(propKey);
    if (!inv) return;

    (inv as any)[line] = ((inv as any)[line] ?? 0) + amount;

    if (!inv.breakdown) inv.breakdown = {};
    if (!inv.breakdown[line]) inv.breakdown[line] = [];
    (inv.breakdown[line] as Contribution[]).push({ employee, amount, allocPct, baseAmount });

    if (line !== "total") inv.total += amount;
  }

  for (const emp of payroll.employees ?? []) {
    const a = findAlloc(emp.name);
    if (!a) continue;

    const isRec = !!a.recoverable;

    for (const [propKey, raw] of Object.entries(a.allocations ?? {})) {
      const pct = pickPct(raw as any);
      if (!pct) continue;

      const baseSalary = emp.salaryAmt ?? 0;
      const baseOT = emp.overtimeAmt ?? 0;
      const baseHol = emp.holAmt ?? 0;
      const baseEr = emp.er401k ?? 0;

      const salaryLine: InvoiceLineKey = isRec ? "salaryREC" : "salaryNR";
      const holLine: InvoiceLineKey = isRec ? "holREC" : "holNR";

      add(propKey, salaryLine, baseSalary * pct, emp.name, pct, baseSalary);
      add(propKey, "overtime", baseOT * pct, emp.name, pct, baseOT);
      add(propKey, holLine, baseHol * pct, emp.name, pct, baseHol);
      add(propKey, "er401k", baseEr * pct, emp.name, pct, baseEr);

      const totalAllocated = (baseSalary + baseOT + baseHol + baseEr) * pct;
      add(propKey, "total", totalAllocated, emp.name, pct, baseSalary + baseOT + baseHol + baseEr);
    }
  }

  const out: PropertyInvoice[] = [];
  for (const inv of invByKey.values()) {
    for (const k of ["salaryREC","salaryNR","overtime","holREC","holNR","er401k","total"] as const) {
      (inv as any)[k] = Math.round(((inv as any)[k] ?? 0) * 100) / 100;
    }
    out.push(inv);
  }

  out.sort((a, b) => (a.propertyKey || "").localeCompare(b.propertyKey || ""));
  return out;
}
