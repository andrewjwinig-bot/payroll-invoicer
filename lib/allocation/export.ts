import * as XLSX from "xlsx";

export type AllocExportEmployee = {
  name: string;
  employeeNumber?: string;
  recoverable: boolean;
  allocations: Record<string, number>; // fractions 0..1
};

/**
 * Builds an allocation template workbook that matches the format expected by
 * parseAllocationWorkbook. Values are written as percentages (0–100) so they
 * can be edited in Excel and re-uploaded without modification.
 */
export function buildAllocationTemplateXlsx(employees: AllocExportEmployee[]): Blob {
  // Collect all unique property keys, sorted
  const propKeys = Array.from(
    new Set(employees.flatMap((e) => Object.keys(e.allocations ?? {})))
  ).sort();

  const header = ["EmployeeID", "EmployeeName", "Recoverable", ...propKeys];

  const rows = employees.map((e) => {
    const row: (string | number)[] = [
      e.employeeNumber ?? "",
      e.name,
      e.recoverable ? "REC" : "NR",
    ];
    for (const key of propKeys) {
      const frac = e.allocations[key] ?? 0;
      row.push(frac > 0 ? Math.round(frac * 10000) / 100 : ""); // percent, 2 dp; blank if 0
    }
    return row;
  });

  const aoa = [header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths
  ws["!cols"] = [
    { wch: 12 }, // EmployeeID
    { wch: 30 }, // EmployeeName
    { wch: 12 }, // Recoverable
    ...propKeys.map(() => ({ wch: 10 })),
  ];

  // Freeze header row
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Allocations");

  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
