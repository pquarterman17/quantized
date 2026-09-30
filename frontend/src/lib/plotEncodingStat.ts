// The Graph Builder's Color / Symbol / Label wells on the CATEGORICAL marks —
// box, violin and bar (PRIMARY_SOFTWARE_AUDIT_PLAN P1.4 residual 3).
//
// COLOR colours each glyph by its level of the Color column (`lib/statColor`):
//   * Color on the X category colours every box / violin / bar by its X level;
//   * Color on another categorical column NESTS each X category by it (the
//     Stat Stage's "then by"), each sub-box coloured by its level;
//   * with no categorical X, the Color column becomes the category axis.
// The plan below is what the Graph Builder preview draws and what a plot
// action sends to the Stat Stage (`statSeed`), which draws and exports it.
//
// REFUSED, each with a one-sentence reason (never silently ignored): Symbol
// (these marks draw no per-series marker), Label (their groups are named on
// the axis), a gradient or text-column Color (no single points to colour; the
// stage groups by sheet columns), and on bars a Color that is not the X
// category or with several Y columns (bars do not nest; colour already tells
// the Y columns apart there).
//
// Lazy, like `lib/plotEncoding`: only the Graph Builder imports it.

import { categoryLevels } from "./categorical";
import { facetSlices } from "./facet";
import { isEncodingFactor } from "./plotEncodingBinding";
import { specDatasetId, type ChannelRef, type PlotSpec, type SpecRender } from "./plotspec";
import { specGroupCol } from "./plotspecGroupCol";
import { analysisData } from "./rowstate";
import { codeLevel, statColorOf, type StatColor } from "./statColor";
import { groupBoxStatsClient, resolveGroups, resolveGroupsIndexed } from "./statstage";
import type { StatStageSeed } from "../store/useApp";
import type { DataStruct, Dataset } from "./types";

export type EncodingSlot = "color" | "symbol" | "label";

/** Is `spec` a box / violin / bar spec? */
export function isStatSpec(spec: PlotSpec): boolean {
  return spec.mark === "box" || spec.mark === "violin" || spec.mark === "bar";
}

/** Why `ref` in `zone` does not apply to this categorical spec (one
 *  sentence), or null when it does — or the spec is not categorical. */
export function statEncodingRefusal(spec: PlotSpec, ds: Dataset, zone: EncodingSlot, ref: ChannelRef): string | null {
  if (!isStatSpec(spec)) return null;
  if (zone === "symbol") return "Box, violin and bar draw no per-series marker, so Symbol does not apply.";
  if (zone === "label") return "Box, violin and bar name their groups on the axis, so Label does not apply.";
  if (ref.text !== undefined) return "Box, violin and bar colour by a column of the sheet, not a text column.";
  if (!isEncodingFactor(ds, ref.channel)) return "A gradient colours single points, which box, violin and bar do not draw.";
  if (spec.mark !== "bar") return null;
  if (ref.channel !== specGroupCol(spec, ds)) return "A bar's colour can only follow its X category.";
  return spec.zones.y.length > 1 ? "With several Y columns, bar colour already tells the columns apart." : null;
}

/** The categorical axis a spec plots, with its Color factor applied. */
export interface StatPlan {
  groupCol: number | null;
  group2Col: number | null;
  colorCol: number | null;
}

/** `spec`'s axis on `ds` (see the module doc); `colorCol` null when Color is
 *  unset or refused. */
export function statPlan(spec: PlotSpec, ds: Dataset): StatPlan {
  const groupCol = specGroupCol(spec, ds);
  const ref = spec.zones.color;
  if (!ref || ref.datasetId !== ds.id || statEncodingRefusal(spec, ds, "color", ref)) {
    return { groupCol, group2Col: null, colorCol: null };
  }
  const c = ref.channel;
  if (groupCol === null) return { groupCol: c, group2Col: null, colorCol: c };
  return { groupCol, group2Col: c === groupCol ? null : c, colorCol: c };
}

/** The Stat Stage seed a plot action sends for a categorical spec. */
export function statSeed(spec: PlotSpec, ds: Dataset): StatStageSeed {
  const p = statPlan(spec, ds);
  const mode = spec.mark === "violin" ? "violin" : spec.mark === "bar" ? "bar" : "box";
  return {
    mode, groupCol: p.groupCol, valueCol: spec.zones.y[0]?.channel ?? 0, facetCol: spec.zones.facet?.channel ?? null,
    ...(p.colorCol === null ? {} : { group2Col: p.group2Col, colorCol: p.colorCol }),
  };
}

/** The plan's colour factor on `ds`, or null. */
export function planColor(plan: StatPlan, ds: Dataset): StatColor | null {
  return statColorOf(ds.data, plan.colorCol, plan.groupCol, plan.group2Col);
}

/** Per box / violin group of `data` (the plan's partition, non-empty groups in
 *  order), its colour level — read off the group's own rows. */
export function groupLevels(data: DataStruct, plan: StatPlan, valueCol: number, c: StatColor): (number | null)[] {
  return resolveGroupsIndexed(data, plan.groupCol, valueCol, [valueCol], plan.group2Col, null)
    .filter((g) => g.points.length > 0)
    .map((g) => codeLevel(c, data.values[g.points[0].rowIndex]?.[c.col]));
}

/** Per bar category of `data` (`buildBarMatrix`'s order), its colour level. */
export function barLevels(data: DataStruct, groupCol: number, c: StatColor): (number | null)[] {
  return categoryLevels(data, groupCol).map((code) => codeLevel(c, code));
}

function label(data: DataStruct, col: number): string {
  return data.labels[col] ?? `col ${col}`;
}

/** The preview's box / violin render for a Color-nested (or Color-grouped)
 *  plan — `specToRender`'s box branch over the plan's axis; null when the
 *  plan changes nothing (`specToRender` then applies unchanged). */
export function statPlanRender(spec: PlotSpec, datasets: readonly Dataset[]): SpecRender | null {
  if (spec.mark !== "box" && spec.mark !== "violin") return null;
  const ds = datasets.find((d) => d.id === specDatasetId(spec));
  const data = ds ? analysisData(ds) : null;
  if (!ds || !data || data.time.length === 0 || spec.zones.y.length === 0) return null;
  const plan = statPlan(spec, ds);
  if (plan.colorCol === null || (plan.group2Col === null && plan.groupCol === specGroupCol(spec, ds))) return null;
  const yChannels = spec.zones.y.map((r) => r.channel);
  const boxesOf = (d: DataStruct) =>
    groupBoxStatsClient(resolveGroups(d, plan.groupCol, yChannels[0], yChannels, plan.group2Col).filter((g) => g.values.length > 0));
  const boxes = boxesOf(data);
  if (boxes.length === 0) return null;
  const facetCol = spec.zones.facet?.channel ?? null;
  const facets = facetCol === null ? [] : facetSlices(data, facetCol).map((s) => ({ label: s.label, boxes: boxesOf(s.data) }));
  const axis = [plan.groupCol, plan.group2Col].flatMap((c) => (c === null ? [] : [label(data, c)]));
  return {
    kind: "box",
    boxes,
    valueLabel: label(data, yChannels[0]),
    groupLabel: axis.join(" / "),
    violin: spec.mark === "violin",
    ...(facets.some((f) => f.boxes.length > 0) ? { facets: facets.filter((f) => f.boxes.length > 0) } : {}),
  };
}
