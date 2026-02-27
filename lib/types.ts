export type PayrollEmployee = {
  name: string;
  // amounts for this pay period
  salaryAmt: number;
  overtimeAmt: number;
  overtimeHours?: number;
  holAmt: number;
  holHours?: number;
  er401k: number;
};

export type PayrollParseResult = {
  payDate?: string;
  reportTotals?: {
    salaryTotal?: number;
    overtimeAmtTotal?: number;
    overtimeHoursTotal?: number;
    holAmtTotal?: number;
    holHoursTotal?: number;
    er401kTotal?: number;
  };
  employees: PayrollEmployee[];
};

export type AllocationEmployee = {
  name: string;
  recoverable?: boolean; // 8502 / REC flag
  // map propertyKey -> percent (0..1)
  allocations: Record<string, number>;
  // optional map for display labels
  propertyLabels?: Record<string, string>;
};

export type AllocationTable = {
  properties: { key: string; label: string }[];
  employees: AllocationEmployee[];
};

export type EmployeeLineContribution = {
  employee: string;
  amount: number;
  allocPct?: number; // 0..1, property allocation %
};

export type InvoiceBreakdown = {
  // key is a line field name like salaryREC, salaryNR, overtime, holREC, holNR, er401k
  [field: string]: EmployeeLineContribution[];
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
  breakdown?: InvoiceBreakdown;
};
