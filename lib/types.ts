export type Property = {
  key: string;
  label: string;
};

export type AllocationEmployee = {
  name: string;
  recoverable?: boolean;
  allocations: Record<string, number>;
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
  er401k: number;
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

export type InvoiceLineKey = "salaryREC" | "salaryNR" | "overtime" | "holREC" | "holNR" | "er401k" | "total";

export type Contribution = {
  employee: string;
  amount: number;
  allocPct?: number;
  baseAmount?: number;
};

export type PropertyInvoice = {
  propertyKey: string;
  propertyLabel: string;
  salaryREC: number;
  salaryNR: number;
  overtime: number;
  holREC: number;
  holNR: number;
  er401k: number;
  total: number;
  breakdown?: Partial<Record<InvoiceLineKey, Contribution[]>>;
};
