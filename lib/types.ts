export type PayrollEmployee = {
  id?: string;
  name: string;
  salaryAmt: number;
  overtimeAmt: number;
  holHours: number;
  holAmt: number;
  er401kAmt: number;
};

export type PayrollParseResult = {
  payDate?: string;
  reportTotals?: {
    salaryTotal?: number;
    overtimeAmtTotal?: number;
    overtimeHoursTotal?: number;
    holHoursTotal?: number;
    holAmtTotal?: number;
    er401kTotal?: number;
  };
  employees: PayrollEmployee[];
};

export type AllocationTable = {
  employees: Array<{
    name: string;
    recoverable: boolean;
    // percent allocations to properties and groups, normalized 0..1
    top: Record<string, number>;
    marketingToGroups: Record<string, number>;
  }>;
  prs: {
    salaryREC: Record<string, Record<string, number>>;
    salaryNR: Record<string, Record<string, number>>;
  };
  propertyMeta: Record<string, { code?: string; label: string }>;
};

export type InvoiceBreakdownRow = { employee: string; amount: number };

export type InvoiceBreakdown = {
  salaryREC: InvoiceBreakdownRow[];
  salaryNR: InvoiceBreakdownRow[];
  overtime: InvoiceBreakdownRow[];
  holREC: InvoiceBreakdownRow[];
  holNR: InvoiceBreakdownRow[];
  er401k: InvoiceBreakdownRow[];
};

export type PropertyInvoice = {
  propertyKey: string;
  propertyLabel: string;
  propertyCode?: string;
  payDate?: string;
  lines: Array<{ description: string; accCode: string; amount: number }>;
  salaryREC: number;
  salaryNR: number;
  overtime: number;
  holREC: number;
  holNR: number;
  er401k: number;
  total: number;

  /** Optional drilldown detail: per-line employee contributions (rounded to cents, zeros omitted). */
  breakdown?: InvoiceBreakdown;
};
