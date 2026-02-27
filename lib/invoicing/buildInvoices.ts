import type { AllocationTable, PayrollParseResult, PropertyInvoice } from "../types";

function normName(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Supports "Last, First" <-> "First Last"
function nameKeys(s: string) {
  const n = normName(s);
  const parts = n.split(" ").filter(Boolean);
  const keys = new Set<string>();
  keys.add(n);
  if (s.includes(",")) {
    const [last, first] = s.split(",").map((x) => normName(x));
    if (first && last) keys.add(`${first} ${last}`.trim());
  }
  if (parts.length >= 2) {
    keys.add(`${parts[1]} ${parts[0]}`); // swap first two
    keys.add(`${parts[parts.length - 1]} ${parts[0]}`); // last first
  }
  return Array.from(keys);
}

type LineField = "salaryREC" | "salaryNR" | "overtime" | "holREC" | "holNR" | "er401k";

export function buildInvoices(payroll: PayrollParseResult, allocation: AllocationTable): PropertyInvoice[] {
  const byNormEmp = new Map<string, { recoverable?: boolean; allocations: Record<string, number> }>();
  for (const emp of allocation.employees) {
    const rec = !!emp.recoverable;
    for (const k of nameKeys(emp.name)) {
      byNormEmp.set(k, { recoverable: rec, allocations: emp.allocations || {} });
    }
  }

  // seed invoice map with all properties so table always shows every property row
  const invByKey = new Map<string, PropertyInvoice>();
  for (const p of allocation.properties || []) {
    invByKey.set(p.key, {
      propertyKey: p.key,
      propertyLabel: p.label || p.key,
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

  function ensureInv(propertyKey: string, label?: string) {
    if (!invByKey.has(propertyKey)) {
      invByKey.set(propertyKey, {
        propertyKey,
        propertyLabel: label || propertyKey,
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
    return invByKey.get(propertyKey)!;
  }

  function add(inv: PropertyInvoice, field: LineField, amount: number, employee: string, allocPct?: number) {
    if (!amount || Math.abs(amount) < 1e-9) return;
    inv[field] += amount;
    inv.total += amount;
    inv.breakdown ||= {};
    inv.breakdown[field] ||= [];
    inv.breakdown[field]!.push({ employee, amount, allocPct });
  }

  for (const emp of payroll.employees || []) {
    // find allocation record
    let allocRec = byNormEmp.get(normName(emp.name));
    if (!allocRec) {
      // try alternate keys
      for (const k of nameKeys(emp.name)) {
        const hit = byNormEmp.get(k);
        if (hit) { allocRec = hit; break; }
      }
    }
    if (!allocRec) continue;

    const recoverable = !!allocRec.recoverable;
    const salaryField: LineField = recoverable ? "salaryREC" : "salaryNR";
    const holField: LineField = recoverable ? "holREC" : "holNR";

    const allocs = allocRec.allocations || {};
    for (const [propKey, pctRaw] of Object.entries(allocs)) {
      const pct = typeof pctRaw === "number" ? pctRaw : Number(pctRaw);
      if (!pct || pct <= 0) continue;
      const inv = ensureInv(propKey);

      add(inv, salaryField, (emp.salaryAmt || 0) * pct, emp.name, pct);
      add(inv, "overtime", (emp.overtimeAmt || 0) * pct, emp.name, pct);
      add(inv, holField, (emp.holAmt || 0) * pct, emp.name, pct);
      add(inv, "er401k", (emp.er401k || 0) * pct, emp.name, pct);
    }
  }

  // sort by property label
  return Array.from(invByKey.values()).sort((a, b) => (a.propertyLabel || "").localeCompare(b.propertyLabel || ""));
}
