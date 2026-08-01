// Per-technique view memory (PLOT_WORKFLOW_PLAN item 5, owner decision
// 2026-07-31): "remember the last-used view per technique tag -- switching
// among XRD scans keeps your XRD view; switching to a VSM loop gets the
// magnetometry view. Reset only on shape mismatch." Builds directly on item
// 2's `techniqueOf`/`isTechniqueChange` (lib/techniqueDefaults.ts) and
// reuses the DisplayBlock precedent's label-based re-key (lib/plotspec2.ts's
// `DisplayBlock.labels` / lib/plotspecApply.ts's `applyDisplayBlock`): a
// remembered channel-keyed field is only as good as the column it named at
// capture time, so every entry carries that column LABEL alongside its
// index and gets re-resolved against the INCOMING dataset's current labels
// -- never blindly replayed by index.
//
// ── FIELD SET ────────────────────────────────────────────────────────────
// Exactly the channel-keyed "silent reset" fields `datasetViewDefaults`
// (store/windows.ts) blanks on every dataset switch: xKey, yKeys, yScale,
// xScale, seriesStyles, seriesLabels, seriesOrder, errKeys, hiddenChannels.
// Deliberately EXCLUDES the OTHER fields that function also resets --
// xLim/yLim/xStep/yStep, and the y2* family (y2Keys/y2Lim/y2Scale/y2Step/
// y2AxisLabel): axis LIMITS are navigation state tied to THIS dataset's own
// numeric data range (replaying a zoom window from a differently-scaled
// prior dataset would land off-data, not "keep your view" -- `xLim:null`
// autoscale is already the sane default), and the y2 family is a rarer,
// more per-dataset-idiosyncratic customization that the owner-approved v1
// field list (this module) doesn't cover -- extending memory to it is a
// deliberate future call, not an oversight.
//
// ── PRECEDENCE (datasetViewDefaults) ────────────────────────────────────
// memory > technique defaults (item 2) > density heuristic (today's
// `yKeys: null` fallback). A technique with no memory yet -- or whose
// memory's `yKeys` resolve to NOTHING on the incoming dataset (the "shape
// mismatch resets" rule; label-resolution failure IS the shape test, no
// separate column-count check) -- falls through to item 2's table.
// `"generic"` never carries memory (unknowable similarity between two
// "generic" datasets) -- capture/apply both no-op for it.

import { isAxisScale } from "./plotview";
import { isValidTechnique, techniqueOf } from "./techniqueDefaults";
import type { AxisScale, Dataset, SeriesStyle, Technique } from "./types";

/** The live view fields this module reads/writes -- deliberately the exact
 *  field subset `TechniqueViewMemory` carries (see the module doc), so a
 *  capture is a straight field copy and an apply patch is a straight field
 *  overlay. `AppState` (the focused window's live singleton fields) and a
 *  background `PlotWindow.view` (a full `PlotView`) both satisfy this
 *  structurally -- no adapter needed at either call site. */
export interface LiveViewSource {
  xKey: number | null;
  yKeys: number[] | null;
  yScale: AxisScale;
  xScale: AxisScale;
  seriesStyles: Record<number, SeriesStyle>;
  seriesLabels: Record<number, string>;
  seriesOrder: number[] | null;
  errKeys: Record<number, number>;
  hiddenChannels: number[];
}

/** One technique's remembered view. `labels` records the column name each
 *  channel-keyed entry (xKey, every yKeys/seriesOrder/hiddenChannels entry,
 *  every seriesStyles/seriesLabels/errKeys key AND errKeys value) named AT
 *  CAPTURE TIME -- so `applyTechniqueMemory` can re-key by label instead of
 *  replaying a now-meaningless index (the DisplayBlock precedent). A channel
 *  whose column had no non-empty label at capture time is simply absent
 *  from `labels` -- `applyTechniqueMemory` falls back to by-index passthrough
 *  for it, mirroring `applyDisplayBlock`'s identical "no worse than before"
 *  fallback for the same case. */
export interface TechniqueViewMemory extends LiveViewSource {
  labels: Record<number, string>;
}

export type TechniqueViewMemoryMap = Partial<Record<Technique, TechniqueViewMemory>>;

/** Every channel index `view` references, for the label snapshot -- shared
 *  by capture (labels FROM the outgoing dataset) and nothing else (apply
 *  re-derives its own resolver from the STORED labels, never re-walks the
 *  incoming dataset this way). */
function referencedChannels(view: LiveViewSource): number[] {
  const out: number[] = [];
  if (view.xKey !== null) out.push(view.xKey);
  out.push(...(view.yKeys ?? []));
  out.push(...Object.keys(view.seriesStyles).map(Number));
  out.push(...Object.keys(view.seriesLabels).map(Number));
  out.push(...(view.seriesOrder ?? []));
  out.push(...view.hiddenChannels);
  for (const [errCh, dataCh] of Object.entries(view.errKeys)) out.push(Number(errCh), dataCh);
  return out;
}

/** Snapshot `prevDs`'s CURRENT live view into `memory`, keyed by its
 *  technique -- the capture half of item 5, called at every "the active
 *  dataset switches away" site alongside `datasetViewDefaults` (and at
 *  save time, folding in the still-focused dataset's unswitched-away
 *  edits). Returns `memory` UNCHANGED (identity) when there's nothing to
 *  capture: no outgoing dataset (a fresh import/split/reimport -- nothing
 *  was "showing" before) or its technique is `"generic"`. Pure -- a new
 *  map, never mutates `memory` in place. */
export function captureTechniqueView(
  prevDs: Dataset | undefined,
  liveView: LiveViewSource,
  memory: TechniqueViewMemoryMap,
): TechniqueViewMemoryMap {
  if (!prevDs) return memory;
  const tech = techniqueOf(prevDs);
  if (tech === "generic") return memory;
  const dsLabels = prevDs.data.labels;
  const labels: Record<number, string> = {};
  for (const ch of referencedChannels(liveView)) {
    const lbl = dsLabels[ch];
    if (typeof lbl === "string" && lbl.length > 0) labels[ch] = lbl;
  }
  return { ...memory, [tech]: { ...liveView, labels } };
}

/** Resolve `memory`'s entry for `ds`'s technique against `ds`'s CURRENT
 *  column labels (the DisplayBlock-style re-key). Returns null when there's
 *  no memory for the technique (`"generic"` never has one) or when the
 *  memory's `yKeys` resolve to NOTHING on this dataset -- the shape-mismatch
 *  rule. A PARTIAL resolution (some channels resolve, others don't) is not
 *  a mismatch as long as at least one yKey survives; unresolved individual
 *  entries are dropped, same tolerance as `applyDisplayBlock`. */
export function applyTechniqueMemory(
  ds: Dataset | undefined,
  memory: TechniqueViewMemoryMap,
): LiveViewSource | null {
  if (!ds) return null;
  const tech = techniqueOf(ds);
  if (tech === "generic") return null; // owner decision: unknowable similarity, no memory
  const remembered = memory[tech];
  if (!remembered) return null;
  const currentLabels = ds.data.labels;
  const resolve = (ch: number): number | null => {
    const label = remembered.labels[ch];
    if (label === undefined) return ch; // never captured a label -> by-index passthrough
    if (currentLabels[ch] === label) return ch; // unchanged position (duplicate-label safe)
    const idx = currentLabels.indexOf(label);
    return idx >= 0 ? idx : null; // moved -> new index; gone -> drop
  };
  const resolveList = (chs: number[]): number[] => [...new Set(chs.map(resolve).filter((c): c is number => c !== null))];

  const yKeys = remembered.yKeys ? resolveList(remembered.yKeys) : null;
  if (remembered.yKeys && remembered.yKeys.length > 0 && yKeys && yKeys.length === 0) return null;

  const seriesStyles: Record<number, SeriesStyle> = {};
  for (const [key, style] of Object.entries(remembered.seriesStyles)) {
    const ch = resolve(Number(key));
    if (ch !== null) seriesStyles[ch] = style;
  }
  const seriesLabels: Record<number, string> = {};
  for (const [key, label] of Object.entries(remembered.seriesLabels)) {
    const ch = resolve(Number(key));
    if (ch !== null) seriesLabels[ch] = label;
  }
  const errKeys: Record<number, number> = {};
  for (const [errKey, dataCh] of Object.entries(remembered.errKeys)) {
    const errCh = resolve(Number(errKey));
    const resolvedData = resolve(dataCh);
    if (errCh !== null && resolvedData !== null) errKeys[errCh] = resolvedData;
  }
  const seriesOrder = remembered.seriesOrder ? resolveList(remembered.seriesOrder) : null;

  return {
    xKey: remembered.xKey !== null ? resolve(remembered.xKey) : null,
    yKeys: yKeys && yKeys.length > 0 ? yKeys : null,
    yScale: remembered.yScale,
    xScale: remembered.xScale,
    seriesStyles,
    seriesLabels,
    seriesOrder: seriesOrder && seriesOrder.length > 0 ? seriesOrder : null,
    errKeys,
    hiddenChannels: resolveList(remembered.hiddenChannels),
  };
}

// ── `.dwk` / untrusted-boundary sanitizer (wired by lib/workspace.ts) ──────

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function numArray(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((n): n is number => typeof n === "number" && Number.isFinite(n)) : [];
}

function numRecord(v: unknown): Record<number, number> {
  if (typeof v !== "object" || v === null) return {};
  const out: Record<number, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "number" && Number.isFinite(val)) out[Number(k)] = val;
  }
  return out;
}

function strRecord(v: unknown): Record<number, string> {
  if (typeof v !== "object" || v === null) return {};
  const out: Record<number, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[Number(k)] = val;
  }
  return out;
}

/** Same structural-passthrough convention `lib/plotview.ts`'s `sanitizeView`
 *  uses for `seriesStyles` -- no deep per-field validation of `SeriesStyle`,
 *  just an object-shape check. A stale/hand-edited entry degrades to `{}`. */
function styleRecord(v: unknown): Record<number, SeriesStyle> {
  return typeof v === "object" && v !== null ? (v as Record<number, SeriesStyle>) : {};
}

function sanitizeEntry(v: unknown): TechniqueViewMemory | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  return {
    xKey: numOrNull(o.xKey),
    yKeys: Array.isArray(o.yKeys) ? numArray(o.yKeys) : null,
    yScale: isAxisScale(o.yScale) ? o.yScale : "linear",
    xScale: isAxisScale(o.xScale) ? o.xScale : "linear",
    seriesStyles: styleRecord(o.seriesStyles),
    seriesLabels: strRecord(o.seriesLabels),
    seriesOrder: Array.isArray(o.seriesOrder) ? numArray(o.seriesOrder) : null,
    errKeys: numRecord(o.errKeys),
    hiddenChannels: numArray(o.hiddenChannels),
    labels: strRecord(o.labels),
  };
}

/** Validate a persisted `.dwk` `techniqueViewMemory` map -- additive-
 *  optional (absent on a legacy doc -> `{}`), never throws. A `"generic"`
 *  key or an unrecognized technique string is dropped (owner decision:
 *  generic never carries memory; a future-toolbox tag from a newer app
 *  version degrades to no memory for it rather than a crash). */
export function sanitizeTechniqueViewMemory(v: unknown): TechniqueViewMemoryMap {
  if (typeof v !== "object" || v === null) return {};
  const out: TechniqueViewMemoryMap = {};
  for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
    if (key === "generic" || !isValidTechnique(key)) continue;
    const entry = sanitizeEntry(val);
    if (entry) out[key] = entry;
  }
  return out;
}
