export function money(n: number | undefined | null) {
  const v = Number(n ?? 0);
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export function num(n: number | undefined | null) {
  const v = Number(n ?? 0);
  return (Math.round(v * 100) / 100).toString();
}

/** Format a percentage from a 0..1 value (e.g., 0.25 => 25.00%) */
export function pct(n: number | undefined | null) {
  const v = Number(n ?? 0);
  const p = v * 100;
  return `${(Math.round(p * 100) / 100).toFixed(2)}%`;
}

export function toNumber(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).replace(/[$,]/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
