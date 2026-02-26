export function money(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export function num(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function normalizeWeights(map: Record<string, number>): Record<string, number> {
  const entries = Object.entries(map).filter(([, v]) => Number.isFinite(v) && v > 0);
  const sum = entries.reduce((a, [, v]) => a + v, 0);
  if (sum <= 0) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of entries) out[k] = v / sum;
  return out;
}

export function safeKey(label: string): string {
  return label
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase();
}
