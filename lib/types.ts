export type Property = {
  key: string;       // property code (e.g. "2010") or name if no code
  label: string;     // usually same as key or a short label
  name?: string;     // friendly property name (from allocation sheet row below codes)
};

export type AllocationEmployee = {
  name: string;
  recoverable?: boolean;                 // TRUE if employee is REC (8502 checked)
  allocations: Record<string, number>;   // propertyKey -> pct (0..1)
};

export type AllocationTable = {
  properties: Property[];
  employees: AllocationEmployee[];
};

export type PayrollEmployee = {
  name: string;
  salaryAmt: number;
  overtimeAmt: number;
  overtimeHours: number;
  holAmt: number;
  holHours: number;
  er401k: number; // ER only
};

export type PayrollParseResult = {
  payDate?: string;
  employees: PayrollEmployee[];
  reportTotals?: {
    salaryTotal?: number;
    overtimeAmtTotal?: number;
    overtimeHoursTotal?: number;
    holAmtTotal?: number;
    holHoursTotal?: number;
    er401kTotal?: number;
  };
};

export type InvoiceLineKey =
  | "salaryREC"
  | "salaryNR"
  | "overtime"
  | "holREC"
  | "holNR"
  | "er401k"
  | "total";

export type Contribution = {
  employee: string;
  amount: number;        // allocated amount (base * pct) for the clicked line item
  allocPct?: number;     // pct used for THIS property
  baseAmount?: number;   // base amount BEFORE allocation for this line item (e.g. employee salary)
};

export type PropertyInvoice = {
  propertyKey: string;
  propertyLabel: string;
  propertyName?: string;
  salaryREC: number;
  salaryNR: number;
  overtime: number;
  holREC: number;
  holNR: number;
  er401k: number;
  total: number;
  breakdown?: Partial<Record<InvoiceLineKey, Contribution[]>>;
};
