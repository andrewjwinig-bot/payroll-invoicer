export type PayrollEmployee = {
  name: string;
  salaryAmt: number;
  overtimeAmt: number;
  holAmt: number;
  holHours: number;
  er401kAmt: number;
};

export type PayrollParseResult = {
  payDate?: string;
  reportTotals: {
    salaryTotal?: number;
    overtimeAmtTotal?: number;
    overtimeHoursTotal?: number;
    holAmtTotal?: number;
    holHoursTotal?: number;
    er401kTotal?: number;
  };
  employees: PayrollEmployee[];
};

export type AllocationParseResult = {
  properties: { key: string; label: string }[];
  employees: {
    name: string;
    recoverable: boolean;
    weightsByProperty: Record<string, number>; // sums to ~1
  }[];
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
};
