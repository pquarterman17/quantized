// The lazy-only half of lib/recode.ts (bundle diet slice 16): find/replace
// mapping, saved-mapping reapply and the panel's channel re-resolve. Only the
// lazy Recode panel, worksheet pane and level-order panel call these, while
// the eager formula engine needs just the recode math, so the code moved here
// verbatim and lib/recode.ts re-exports it with `export *` - importers are
// unchanged, and Rollup bundles this file with the lazy chunks that use it.
// architecture.test.ts ("re-exported lazy half") keeps eager modules off it.

import type { RecodeMapping } from "./recode";

/** A saved, re-applicable recode recipe (J2 item 3). Persisted in the
 *  `.dwk` (`savedRecodeMappings`, sanitized by `sanitizeSavedRecodeMappings`) --
 *  `sourceLevels` is kept for DISPLAY only ("built from: Pass, Fail, Retry");
 *  `resolveRecodeMapping` (lib/recodeMappings.ts) always checks the live TARGET's levels, never
 *  this snapshot, so a saved mapping degrades honestly even if its original
 *  source column has since changed. */
export interface SavedRecodeMapping {
  id: string;
  name: string;
  mapping: RecodeMapping;
  sourceLevels: string[];
  createdAt: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build a recode mapping from a plain find/replace over a column's level
 *  STRINGS (J2's "plain find-replace over text cells" -- for a categorical
 *  column, its "text cells" are the level strings every row displays). Only
 *  levels actually containing `find` get a group; levels that collide onto
 *  the same replaced text merge into ONE group (a deliberate, visible side
 *  effect of find-replace, not a bug -- the preview table shows it). An
 *  empty `find` is a no-op mapping (nothing would match). */
export function mappingFromFindReplace(
  oldLevels: readonly string[],
  find: string,
  replace: string,
  opts?: { caseSensitive?: boolean },
): RecodeMapping {
  if (find === "") return { groups: [] };
  const caseSensitive = opts?.caseSensitive ?? true;
  const test = (s: string): boolean =>
    caseSensitive ? s.includes(find) : s.toLowerCase().includes(find.toLowerCase());
  const replaceAll = (s: string): string =>
    caseSensitive ? s.split(find).join(replace) : s.replace(new RegExp(escapeRegExp(find), "gi"), replace);
  const byLabel = new Map<string, string[]>();
  for (const oldLevel of oldLevels) {
    if (!test(oldLevel)) continue;
    const newLabel = replaceAll(oldLevel);
    const list = byLabel.get(newLabel);
    if (list) list.push(oldLevel);
    else byLabel.set(newLabel, [oldLevel]);
  }
  return { groups: [...byLabel.entries()].map(([newLabel, from]) => ({ newLabel, from })) };
}

export type RecodeMappingResolution = { ok: true } | { ok: false; unmatched: string[]; reason: string };

/** Can a SAVED `mapping` (built against some earlier source's levels) be
 *  reapplied cleanly to a DIFFERENT column/dataset's CURRENT `targetLevels`?
 *  Refuses the WHOLE apply -- never a partial one -- when any old level the
 *  mapping names in a group's `from` doesn't exist on the target: that group
 *  member can never be reached during recompute, so its intended merge/
 *  rename silently never fires for that level. Every unmatched level is
 *  named (P1.6's `resolveImportFilter` shape: all-or-nothing, name every
 *  mismatch) -- an independent type, no coupling to `ImportFilterWire` or
 *  `quickPlotTemplates`; recode mappings are their own object. A level the
 *  mapping never mentions is fine either way (it passes through as identity
 *  on any target, same as on the mapping's original source). */
export function resolveRecodeMapping(
  mapping: RecodeMapping,
  targetLevels: readonly string[],
): RecodeMappingResolution {
  const targetSet = new Set(targetLevels);
  const seen = new Set<string>();
  const unmatched: string[] = [];
  for (const g of mapping.groups) {
    for (const oldLevel of g.from) {
      if (!targetSet.has(oldLevel) && !seen.has(oldLevel)) {
        seen.add(oldLevel);
        unmatched.push(oldLevel);
      }
    }
  }
  if (unmatched.length) {
    return {
      ok: false,
      unmatched,
      reason:
        `${unmatched.length} level${unmatched.length === 1 ? "" : "s"} in this mapping ` +
        `${unmatched.length === 1 ? "doesn't" : "don't"} exist on the target column: ${unmatched.join(", ")}`,
    };
  }
  return { ok: true };
}

export type RecodeChannelResolution = { ok: true; channel: number } | { ok: false; reason: string };

/** DEFECT B closure (Sol audit P1-3): the non-modal RecodePanel keeps
 *  `channel` as a plain index for the life of the panel, so a column shift
 *  elsewhere mid-edit (a formula/recode column removed, a reimport) can
 *  silently retarget it at a DIFFERENT column sitting at that same index.
 *  Re-resolve the identity captured at open time (`openLabel`) against the
 *  dataset's CURRENT labels before any commit trusts `channel`:
 *   - still the same label at that index -> unchanged, proceed.
 *   - a different label there now, but exactly ONE column elsewhere in the
 *     dataset still carries `openLabel` -> retarget to that column.
 *   - zero, or more than one, match -> refuse (name the column) rather than
 *     guess which one the user meant. */
export function resolveRecodeChannel(
  labels: readonly string[],
  channel: number,
  openLabel: string,
): RecodeChannelResolution {
  if (labels[channel] === openLabel) return { ok: true, channel };
  const matches: number[] = [];
  labels.forEach((label, i) => {
    if (label === openLabel) matches.push(i);
  });
  if (matches.length === 1) return { ok: true, channel: matches[0] };
  if (matches.length === 0) {
    return { ok: false, reason: `can't commit recode: column "${openLabel}" no longer exists` };
  }
  return {
    ok: false,
    reason: `can't commit recode: "${openLabel}" is ambiguous now (${matches.length} columns share that name) — reopen Recode on the column you want`,
  };
}

const MAX_SAVED_MAPPINGS = 200;
const MAX_GROUPS = 500;
const MAX_LEVELS = 5000;
const MAX_TEXT = 200;

const strings = (v: unknown, max: number): string[] | null =>
  Array.isArray(v) && v.length <= max && v.every((x) => typeof x === "string" && x.length <= MAX_TEXT) ? (v as string[]) : null;

/** Load-time sanitizer for the `.dwk` `savedRecodeMappings` list (the
 *  `sanitizeSavedSampleProfiles` convention): a malformed entry is dropped,
 *  never repaired or thrown on. A mapping whose group is malformed is refused
 *  whole -- a half-read recipe would silently recode the wrong levels. Duplicate
 *  ids keep the first; at most {@link MAX_SAVED_MAPPINGS} are kept. */
export function sanitizeSavedRecodeMappings(raw: unknown): SavedRecodeMapping[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SavedRecodeMapping[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const m = e.mapping as { groups?: unknown } | null | undefined;
    const groups = m && Array.isArray(m.groups) && m.groups.length <= MAX_GROUPS ? m.groups : null;
    const levels = strings(e.sourceLevels, MAX_LEVELS);
    if (typeof e.id !== "string" || !e.id || e.id.length > 64 || seen.has(e.id) || typeof e.name !== "string" || !e.name.trim() || !groups || !levels) continue;
    const clean: RecodeMapping["groups"] = [];
    for (const g of groups as { newLabel?: unknown; from?: unknown }[]) {
      const from = g && typeof g === "object" ? strings(g.from, MAX_LEVELS) : null;
      if (!from || typeof g.newLabel !== "string" || g.newLabel.length > MAX_TEXT) break;
      clean.push({ newLabel: g.newLabel, from: [...from] });
    }
    if (clean.length !== groups.length) continue;
    seen.add(e.id);
    out.push({
      id: e.id,
      name: e.name.trim().slice(0, 120),
      mapping: { groups: clean },
      sourceLevels: [...levels],
      createdAt: typeof e.createdAt === "string" ? e.createdAt.slice(0, 40) : "",
    });
    if (out.length >= MAX_SAVED_MAPPINGS) break;
  }
  return out;
}
