import { AllocationTable, PayrollParseResult, PropertyInvoice, Contribution, InvoiceLineKey } from "../types";

function normName(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lastName(s: string) {
  const n = normName(s);
  const parts = n.split(" ").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : n;
}

function firstInitial(s: string) {
  const n = normName(s);
  return n ? n[0] : "";
}

function pickAllocPct(raw: number): number {
  if (!isFinite(raw) || raw <= 0) return 0;
  if (raw > 1.5) return raw / 100;
  return raw;
}

export function buildInvoices(payroll: PayrollParseResult, allocation: AllocationTable): PropertyInvoice[] {
  const props = allocation.properties?.length
    ? allocation.properties
    : (() => {
        const set = new Set<string>();
        for (const e of allocation.employees ?? []) {
          for (const k of Object.keys(e.allocations ?? {})) set.add(k);
        }
        return [...set].sort().map((k) => ({ key: k, label: k, name: "" }));
      })();

  const invByKey = new Map<string, PropertyInvoice>();
  for (const p of props) {
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

  // Index allocation employees
  const byFull = new Map<string, { name: string; recoverable: boolean; allocations: Record<string, number> }>();
  const byLast = new Map<string, { name: string; recoverable: boolean; allocations: Record<string, number> }[]>();

  for (const ae of allocation.employees ?? []) {
    const f = normName(ae.name);
    const l = lastName(ae.name);
    const entry = { name: ae.name, recoverable: !!ae.recoverable, allocations: ae.allocations ?? {} };
    byFull.set(f, entry);
    const arr = byLast.get(l) ?? [];
    arr.push(entry);
    byLast.set(l, arr);
  }

  function findAlloc(empName: string) {
    const f = normName(empName);
    const direct = byFull.get(f);
    if (direct) return direct;

    const l = lastName(empName);
    const candidates = byLast.get(l) ?? [];
    if (candidates.length === 1) return candidates[0];

    const fi = firstInitial(empName);
    const match = candidates.find((c) => firstInitial(c.name) === fi);
    if (match) return match;

    return candidates[0];
  }

  function add(
    propKey: string,
    line: InvoiceLineKey,
    amount: number,
    employee: string,
    allocPct?: number,
    baseAmount?: number
  ) {
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

    for (const [propKey, rawPct] of Object.entries(a.allocations ?? {})) {
      const pct = pickAllocPct(rawPct);
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

      const totalBase = baseSalary + baseOT + baseHol + baseEr;
      add(propKey, "total", totalBase * pct, emp.name, pct, totalBase);
    }
  }

  const out: PropertyInvoice[] = [];
  for (const inv of invByKey.values()) {
    for (const k of ["salaryREC", "salaryNR", "overtime", "holREC", "holNR", "er401k", "total"] as const) {
      (inv as any)[k] = Math.round(((inv as any)[k] ?? 0) * 100) / 100;
    }
    out.push(inv);
  }

  out.sort((a, b) => (a.propertyKey || "").localeCompare(b.propertyKey || ""));
  return out;
}
