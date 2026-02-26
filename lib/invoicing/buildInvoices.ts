import { AllocationParseResult, PayrollParseResult, PropertyInvoice } from "../types";

export function buildInvoices(payroll: PayrollParseResult, alloc: AllocationParseResult): PropertyInvoice[] {
  const propLabelByKey = new Map<string, string>();
  for (const p of alloc.properties) propLabelByKey.set(p.key, p.label);

  const invoices: Record<string, PropertyInvoice> = {};
  function ensure(key: string): PropertyInvoice {
    if (!invoices[key]) {
      invoices[key] = {
        propertyKey: key,
        propertyLabel: propLabelByKey.get(key) ?? key,
        salaryREC: 0,
        salaryNR: 0,
        overtime: 0,
        holREC: 0,
        holNR: 0,
        er401k: 0,
        total: 0,
      };
    }
    return invoices[key];
  }

  const payrollByName = new Map<string, typeof payroll.employees[number]>();
  for (const e of payroll.employees) payrollByName.set(normName(e.name), e);

  for (const e of alloc.employees) {
    const pe = payrollByName.get(normName(e.name));
    if (!pe) continue;

    for (const [propKey, w] of Object.entries(e.weightsByProperty)) {
      if (!w || w <= 0) continue;
      const inv = ensure(propKey);

      const sal = pe.salaryAmt * w;
      if (e.recoverable) inv.salaryREC += sal;
      else inv.salaryNR += sal;

      inv.overtime += pe.overtimeAmt * w;
      const hol = pe.holAmt * w;
      if (e.recoverable) inv.holREC += hol;
      else inv.holNR += hol;
      inv.er401k += pe.er401kAmt * w;
    }
  }

  const out = Object.values(invoices)
    .map((i) => ({ ...i, total: i.salaryREC + i.salaryNR + i.overtime + i.holREC + i.holNR + i.er401k }))
    .sort((a, b) => a.propertyLabel.localeCompare(b.propertyLabel));

  return out;
}

function normName(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\./g, "")
    .trim();
}
