// The lazy-only half of lib/recode.ts (bundle diet slice 16): find/replace
// mapping, saved-mapping reapply and the panel's channel re-resolve. Only the
// lazy Recode panel, worksheet pane and level-order panel call these, while
// the eager formula engine needs just the recode math, so the code moved here
// verbatim and lib/recode.ts re-exports it with `export *` - importers are
// unchanged, and Rollup bundles this file with the lazy chunks that use it.
// architecture.test.ts ("re-exported lazy half") keeps eager modules off it.

import type { RecodeMapping } from "./recode";

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
