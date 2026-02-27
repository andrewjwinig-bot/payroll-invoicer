export type Property = {
  key: string; // property code string, or name if no code
  label: string; // usually the code (display)
  name?: string; // property name (optional)
};

export type AllocationEmployee = {
  name: string;
  recoverable?: boolean;
  allocations: Record<string, number>; // propertyKey -> pct (0..1)
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
  er401k: number; // employer 401k only
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
  amount: number; // allocated amount (base * pct)
  allocPct?: number; // pct used for THIS property
  baseAmount?: number; // base amount before allocation (employee amount for this category)
};

export type PropertyInvoice = {
  propertyKey: string;
  propertyLabel: string; // code label
  propertyName?: string; // name from allocation sheet if available
  salaryREC: number;
  salaryNR: number;
  overtime: number;
  holREC: number;
  holNR: number;
  er401k: number;
  total: number;
  breakdown?: Partial<Record<InvoiceLineKey, Contribution[]>>;
};
