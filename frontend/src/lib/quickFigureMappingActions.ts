// Quick Figure Builder mapping-EDIT actions (plan PR G2), split out of
// `lib/quickFigureMapping.ts` (2026-08-23, C2 bundle pass — see
// `frontend/scripts/check-bundle-size.mjs`'s header for the ratchet this
// split feeds). `lib/quickFigureMapping.ts` keeps the `QuickFigureMapping`
// shape + the create-gate predicates (`mappingReady`/`canCreateQuickFigure`
// and their helpers), which `lib/quickFigurePreview.ts`/
// `store/quickFigureCreate.ts`/`store/quickPlotTemplates.ts` need EAGERLY;
// the functions below (build an initial mapping from a dataset, read/change
// one column's assignment, clear X back to the acquisition axis) are reached
// ONLY from the Quick Figure Builder workshop panel — already `lazy()`-gated,
// never the eager create-gate path. Co-locating them was dragging this
// editing logic into the eager graph purely by file co-location, the same
// mechanism R8's `lib/api.ts`/primitives-barrel passes already fixed
// elsewhere. Verified before moving: neither `mappingReady` nor
// `canCreateQuickFigure` (nor anything they call internally) references any
// export below, and every real (non-test) importer of what moved is the
// (lazy) `components/workshops/quickfigurebuilder/*`.

import { reviewSeedErrorBindings } from "./errorBindingConfidence";
import { figureSeedErrorBindings, type ErrorBinding, type ErrorSide } from "./errorRoles";
import { columnMetaList } from "./columnmeta";
import { originHiddenChannels } from "./errorbars";
import type { QuickFigureMapping } from "./quickFigureMapping";
import type { Dataset } from "./types";

export type QuickColumnAssignment =
  | { role: "unassigned" }
  /** The SHARED X (every Y without its own). */
  | { role: "x" }
  /** The own X of these Y series (multi-X worksheets). */
  | { role: "series-x"; targets: number[] }
  | { role: "y" }
  | { role: "ignore" }
  /** Single-slot roles: a label column (per-point text) and a grouping
   *  column (one series per level). Assigning either to a new column moves it. */
  | { role: "label" }
  | { role: "group" }
  | { role: "error"; target: number; axis: "x" | "y"; side: ErrorSide };

const uniqueSorted = (values: readonly number[]): number[] => [...new Set(values)].sort((a, b) => a - b);

/** Columns holding a plotted/paired role, which therefore cannot be a Y's X. */
function busyChannels(mapping: QuickFigureMapping): Set<number> {
  return new Set([
    ...mapping.yKeys,
    ...mapping.errorBindings.map((binding) => binding.channel),
    ...(mapping.groupKey != null ? [mapping.groupKey] : []),
    ...(mapping.labelKey != null ? [mapping.labelKey] : []),
  ]);
}

/** Keep only per-Y X overrides that still mean something: keyed by a current
 *  Y, different from the shared X, and naming the acquisition axis or a
 *  column with no other role. A column adopted as a series X leaves Ignore.
 *  Drops the field entirely when none remain, so a shared-X mapping keeps
 *  exactly its pre-existing shape. */
function normalizeSeriesX(mapping: QuickFigureMapping): QuickFigureMapping {
  const { xKeyByY, ...rest } = mapping;
  if (!xKeyByY) return mapping;
  const busy = busyChannels(mapping);
  const kept = Object.entries(xKeyByY)
    .map(([y, x]) => [Number(y), x] as const)
    .filter(([y, x]) => mapping.yKeys.includes(y) && x !== mapping.xKey && (x === null || !busy.has(x)));
  if (kept.length === 0) return rest;
  const used = new Set(kept.map(([, x]) => x));
  return { ...rest, xKeyByY: Object.fromEntries(kept), ignoredKeys: rest.ignoredKeys.filter((c) => !used.has(c)) };
}

/** Origin's own multi-X rule (`io/origin_project/opj_curves.py`'s
 *  `_nearest_preceding_x`): a Y plots against the NEAREST-PRECEDING
 *  X-designated column. The book's first X is the acquisition axis (`time`),
 *  so a Y with no X value column before it keeps the shared X. Explicit
 *  designations are the only evidence -- adjacency alone never pairs. */
function inferSeriesX(dataset: Dataset, yKeys: readonly number[]): Record<number, number> {
  const meta = columnMetaList(dataset.data);
  const out: Record<number, number> = {};
  for (const y of yKeys) {
    for (let c = y - 1; c >= 0; c--) {
      if (meta[c]?.designation === "X") {
        out[y] = c;
        break;
      }
    }
  }
  return out;
}

/** The builder's first mapping. Error bindings come from the shared seed
 *  (`figureSeedErrorBindings`) through the CONFIDENCE GRADE
 *  (`reviewSeedErrorBindings`): an adjacency-only (`low`) or unit-`blocked`
 *  pairing is WITHHELD -- its column starts as Ignore, neither an error nor a
 *  Y, and `QuickErrorSuggestions` asks before applying a `low` one. */
export function initialQuickFigureMapping(dataset: Dataset): QuickFigureMapping {
  const inferred = reviewSeedErrorBindings(dataset).apply;
  const errorChannels = new Set(inferred.map((binding) => binding.channel));
  const withheld = figureSeedErrorBindings(dataset)
    .map((binding) => binding.channel)
    .filter((channel) => !errorChannels.has(channel));
  const hidden = new Set(originHiddenChannels(dataset.data));
  const ignored = new Set([
    ...withheld,
    ...Object.entries(dataset.channelRoles ?? {})
      .filter(([, role]) => role === "ignore" || role === "label")
      .map(([channel]) => Number(channel)),
  ]);
  const yKeys = dataset.data.labels
    .map((_, channel) => channel)
    .filter((channel) => !errorChannels.has(channel) && !hidden.has(channel) && !ignored.has(channel));
  return normalizeSeriesX({
    xKey: null,
    xKeyByY: inferSeriesX(dataset, yKeys),
    yKeys,
    errorBindings: inferred,
    ignoredKeys: uniqueSorted([...ignored, ...hidden].filter((channel) => !errorChannels.has(channel))),
  });
}

export function assignmentFor(mapping: QuickFigureMapping, channel: number): QuickColumnAssignment {
  if (mapping.xKey === channel) return { role: "x" };
  const own = mapping.xKeyByY ?? {};
  const targets = mapping.yKeys.filter((y) => Object.hasOwn(own, y) && own[y] === channel);
  if (targets.length > 0) return { role: "series-x", targets };
  if (mapping.yKeys.includes(channel)) return { role: "y" };
  if (mapping.groupKey === channel) return { role: "group" };
  if (mapping.labelKey === channel) return { role: "label" };
  const binding = mapping.errorBindings.find((candidate) => candidate.channel === channel);
  if (binding) return { role: "error", target: binding.target, axis: binding.axis, side: binding.side };
  if (mapping.ignoredKeys.includes(channel)) return { role: "ignore" };
  return { role: "unassigned" };
}

/** X-error bindings carry `target: -1` (the axis sentinel, not a real
 * channel index) -- they are paired with WHICHEVER column is currently X,
 * not with a specific target channel. So whenever X itself changes identity
 * (reassigned to a different column, cleared to the acquisition axis, or the
 * old X channel is given a different role), every `axis: "x"` binding is
 * stale and must be dropped rather than silently kept pointed at the old X.
 * Keeping one would render a "confidently wrong" error bar for data it was
 * never paired with (see lib/errorRoles.ts's module docstring). */
function dropXErrorBindings(bindings: readonly ErrorBinding[]): ErrorBinding[] {
  return bindings.filter((binding) => binding.axis !== "x");
}

/** Drop any existing binding from a DIFFERENT channel targeting the same
 * (target, axis, side) -- two source columns must never both claim the same
 * error slot. The render helpers (errorbars.ts's symmetricBinding/
 * asymmetricPair) use `.find()` and would otherwise silently draw only the
 * first match, dropping the user's later choice. `side` is part of the key
 * so a `+` and a `-` half for the same target coexist; two `+`es do not. */
function dropConflictingErrorBinding(
  bindings: readonly ErrorBinding[],
  channel: number,
  target: number,
  axis: "x" | "y",
  side: ErrorSide,
): ErrorBinding[] {
  return bindings.filter(
    (binding) =>
      binding.channel === channel ||
      !(binding.target === target && binding.axis === axis && binding.side === side),
  );
}

/** Assign one values channel. Reassigning removes every incompatible old role;
 * changing X leaves the old X unassigned rather than silently making it Y. */
export function assignQuickFigureColumn(
  mapping: QuickFigureMapping,
  channel: number,
  assignment: QuickColumnAssignment,
): QuickFigureMapping {
  const base: QuickFigureMapping = {
    xKey: mapping.xKey === channel ? null : mapping.xKey,
    yKeys: mapping.yKeys.filter((candidate) => candidate !== channel),
    errorBindings: mapping.errorBindings.filter(
      (binding) => binding.channel !== channel && binding.target !== channel,
    ),
    ignoredKeys: mapping.ignoredKeys.filter((candidate) => candidate !== channel),
    // Optional single-slot roles are carried only while set (and not the
    // channel being reassigned), so a mapping that never uses them keeps
    // exactly its pre-existing shape (templates, snapshots, equality).
    ...(mapping.groupKey != null && mapping.groupKey !== channel ? { groupKey: mapping.groupKey } : {}),
    ...(mapping.labelKey != null && mapping.labelKey !== channel ? { labelKey: mapping.labelKey } : {}),
    // A column leaving the series-X role takes its Ys back to the shared X
    // (never silently onto another column); `normalizeSeriesX` below drops
    // the rest (a Y that stopped being Y, an override now equal to X).
    ...(mapping.xKeyByY
      ? { xKeyByY: Object.fromEntries(Object.entries(mapping.xKeyByY).filter(([, x]) => x !== channel)) }
      : {}),
  };
  const result = ((): QuickFigureMapping => {
    switch (assignment.role) {
      case "unassigned": return base;
      case "x": return { ...base, xKey: channel };
      case "series-x": {
        const own: Record<number, number | null> = { ...base.xKeyByY };
        for (const y of assignment.targets) own[y] = channel;
        return { ...base, xKeyByY: own };
      }
      case "y": return { ...base, yKeys: uniqueSorted([...base.yKeys, channel]) };
      case "ignore": return { ...base, ignoredKeys: uniqueSorted([...base.ignoredKeys, channel]) };
      case "group": return { ...base, groupKey: channel };
      case "label": return { ...base, labelKey: channel };
      case "error":
        return {
          ...base,
          errorBindings: [
            ...dropConflictingErrorBinding(base.errorBindings, channel, assignment.target, assignment.axis, assignment.side),
            { channel, target: assignment.target, axis: assignment.axis, side: assignment.side },
          ],
        };
    }
  })();
  // X changed identity (reassigned, or the old X left the role above) --
  // every x-error binding referenced the OLD X and is now stale.
  if (result.xKey !== mapping.xKey) {
    return normalizeSeriesX({ ...result, errorBindings: dropXErrorBindings(result.errorBindings) });
  }
  return normalizeSeriesX(result);
}

export function useAcquisitionAxis(mapping: QuickFigureMapping): QuickFigureMapping {
  if (mapping.xKey === null) return mapping;
  return normalizeSeriesX({ ...mapping, xKey: null, errorBindings: dropXErrorBindings(mapping.errorBindings) });
}

/** What Y series `y` may plot against, in column order: the acquisition axis
 *  (null) and every column but `y` itself and the error / group / label
 *  columns -- including another Y, since a CSV `X1,Y1,X2,Y2` imports its X2
 *  as a Y (no designations) and pairing is how the user says otherwise. */
export function seriesXCandidates(mapping: QuickFigureMapping, channelCount: number, y: number): (number | null)[] {
  const busy = busyChannels({ ...mapping, yKeys: [y] });
  return [null, ...Array.from({ length: channelCount }, (_, c) => c).filter((c) => !busy.has(c))];
}

/** Reassign ONE Y series' X: "shared" follows the shared X again; null is the
 *  acquisition axis; a channel adopts that column -- leaving Ignore, or
 *  leaving the Y role (and its Y error pairing) when it was plotted as a Y.
 *  X error stays with the shared X -- the only X an error binding can name. */
export function assignSeriesX(mapping: QuickFigureMapping, y: number, x: number | null | "shared"): QuickFigureMapping {
  if (!mapping.yKeys.includes(y) || x === y) return mapping;
  const base = typeof x === "number" && mapping.yKeys.includes(x)
    ? assignQuickFigureColumn(mapping, x, { role: "unassigned" })
    : mapping;
  const own: Record<number, number | null> = { ...base.xKeyByY };
  if (x === "shared") delete own[y];
  else own[y] = x;
  return normalizeSeriesX({ ...base, xKeyByY: own });
}
