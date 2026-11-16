// Per-user command usage for the ⌘K palette: how often and how lately each
// command was run, persisted in localStorage so the empty palette can offer
// "Recent" and the ranker can break ties toward what this person actually
// uses (`lib/paletteRank.ts`).
//
// Stores command IDS only (never labels, dataset names or paths), so the slot
// stays safe to name in a diagnostics bundle (`lib/storageKeys.ts`). Every
// storage access is guarded: a private window, a blocked store or a corrupt
// value costs the boost, never the palette.

export const PALETTE_USAGE_KEY = "qz.paletteUsage";

export interface UsageEntry {
  /** Times run. */
  n: number;
  /** Epoch ms of the latest run. */
  t: number;
}
export type UsageMap = Readonly<Record<string, UsageEntry>>;

/** Entries kept; the least recently used are dropped past this. */
const MAX_ENTRIES = 60;
/** The boost never exceeds this. Together with the ranker's first-word bonus
 *  (2) it stays under 5, the smallest step between two match sub-tiers in
 *  `paletteRank.ts` (exact 100 / stem 95 / prefix 90, keyword 50 / 45 / 40,
 *  description 30 / 25 / 20): usage reorders WITHIN a sub-tier, never across. */
export const MAX_USAGE_BOOST = 2.9;
const HALF_LIFE_DAYS = 14;
const DAY_MS = 86_400_000;

function isEntry(v: unknown): v is UsageEntry {
  return typeof v === "object" && v !== null
    && Number.isFinite((v as UsageEntry).n) && (v as UsageEntry).n > 0
    && Number.isFinite((v as UsageEntry).t);
}

/** The stored usage, or `{}` when absent, unreadable or malformed. */
export function loadUsage(): UsageMap {
  try {
    const raw = localStorage.getItem(PALETTE_USAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, UsageEntry> = {};
    for (const [id, v] of Object.entries(parsed)) if (isEntry(v)) out[id] = { n: v.n, t: v.t };
    return out;
  } catch {
    return {};
  }
}

/** Count one run of command `id`. Silent on a storage failure. */
export function recordUse(id: string, now: number = Date.now()): void {
  try {
    const next: Record<string, UsageEntry> = { ...loadUsage() };
    next[id] = { n: (next[id]?.n ?? 0) + 1, t: now };
    const keep = Object.entries(next).sort((a, b) => b[1].t - a[1].t).slice(0, MAX_ENTRIES);
    localStorage.setItem(PALETTE_USAGE_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch {
    // Quota, private mode or blocked storage: the palette works without it.
  }
}

/** Frequency x recency, 0..MAX_USAGE_BOOST: logarithmic in the run count (the
 *  tenth run matters far less than the first) and halving every two weeks. */
export function usageBoost(entry: UsageEntry | undefined, now: number): number {
  if (!entry) return 0;
  const ageDays = Math.max(0, now - entry.t) / DAY_MS;
  return Math.min(MAX_USAGE_BOOST, 2.5 * Math.log2(1 + entry.n)) * 0.5 ** (ageDays / HALF_LIFE_DAYS);
}

/** Command ids, most recently run first. */
export function recentIds(usage: UsageMap, limit: number): string[] {
  return Object.entries(usage)
    .sort((a, b) => b[1].t - a[1].t)
    .slice(0, limit)
    .map(([id]) => id);
}
