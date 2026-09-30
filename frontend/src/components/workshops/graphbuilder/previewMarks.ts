// The Graph Builder preview's categorical marks (JMP_GAP J5 residual, closed
// 2026-09-29). `lib/plotspec.specToRender` builds the box stats / bar matrix
// (pure, no marks); this turns that render into the draws the preview
// paints, carrying the window's per-mode `PlotView.statMarks` — the SAME
// options the Stat Stage the spec is sent to draws with — and the raw points
// those marks need, resolved exactly as the stage resolves them:
//
//   * one marks resolution (`Stage/statStageMarks.stageMarks`, then
//     `facetMarks` for a panel) and one "which points" rule (`needsPoints` /
//     `statBarMarks.needsBarRaw`);
//   * points on ORIGINAL dataset rows — the analysis view's `rowIds`, and per
//     facet slice `lib/facet.facetSliceRowIds` — so a point's jitter hash is
//     the stage's and the export's;
//   * the same columns as the render (`lib/plotspecGroupCol.specGroupCol`,
//     the first Y as the value, every Y as a bar series).
//
// A violin's box draw carries the violin's marks, plus its groups
// (`violin`), from which `./usePreviewViolins` fetches the KDE the Stat Stage
// draws; the box stands in until then, or when the backend is unreachable.
// No spec (or no dataset) = the unmarked draws the preview always made.

import { facetSlices, facetSliceRowIds, type FacetSlice } from "../../../lib/facet";
import { specDatasetId, type PlotSpec, type SpecRender } from "../../../lib/plotspec";
import { specGroupCol } from "../../../lib/plotspecGroupCol";
import type { StatMarksByMode } from "../../../lib/plotviewSanitize";
import { analysisView } from "../../../lib/rowstate";
import type { ResolvedStatMarks } from "../../../lib/statMarks";
import type { GroupSpec } from "../../../lib/statschooser";
import { resolveGroups, resolveGroupsIndexed, type IndexedGroupSpec } from "../../../lib/statstage";
import type { DataStruct, Dataset } from "../../../lib/types";
import { barCellPoints, needsBarRaw, withBarRaw } from "../../Stage/statBarMarks";
import type { StatDrawData } from "../../Stage/statRender";
import { facetMarks, needsPoints, stageMarks } from "../../Stage/statStageMarks";

type StatRender = Extract<SpecRender, { kind: "box" | "bar" }>;

export interface PreviewStatDraws {
  flat: StatDrawData | null;
  facets: { label: string; draw: StatDrawData }[] | null;
  /** A violin render's groups — the KDE's input (`./usePreviewViolins`),
   *  aligned with `flat` and `facets`. Absent for box / bar, or with no spec. */
  violin?: { flat: GroupSpec[]; facets: GroupSpec[][] };
}

/** What one draw needs to resolve its raw points: the rows it was built
 *  from and their ORIGINAL dataset indices. */
interface Source {
  data: DataStruct;
  rowIds: readonly number[] | null;
}

interface Ctx {
  groupCol: number | null;
  yChannels: number[];
  m: ResolvedStatMarks;
}

function boxDraw(
  r: Extract<StatRender, { kind: "box" }>,
  boxes: Extract<StatRender, { kind: "box" }>["boxes"],
  src: Source | null,
  ctx: Ctx | null,
): StatDrawData {
  const draw: StatDrawData = { mode: "box", boxes, valueLabel: r.valueLabel, groupLabel: r.groupLabel };
  if (!ctx) return draw;
  const mode = r.violin ? "violin" : "box";
  let points: IndexedGroupSpec[] | null = null;
  if (src && needsPoints(mode, ctx.m)) {
    // specToRender's own partition (index-aligned with `boxes`).
    points = resolveGroupsIndexed(src.data, ctx.groupCol, ctx.yChannels[0], ctx.yChannels, null, src.rowIds)
      .filter((g) => g.points.length > 0);
  }
  return { ...draw, points, marks: ctx.m };
}

function barDraw(
  r: Extract<StatRender, { kind: "bar" }>,
  data: Extract<StatRender, { kind: "bar" }>["data"],
  src: Source | null,
  ctx: Ctx | null,
): StatDrawData {
  const draw: StatDrawData = { mode: "bar", data, valueLabel: r.valueLabel, groupLabel: r.groupLabel, stacked: r.stacked };
  if (!ctx) return draw;
  const raw = src && needsBarRaw(ctx.m)
    ? withBarRaw(data, barCellPoints(src.data, ctx.groupCol, ctx.yChannels, ctx.yChannels[0], ctx.yChannels, src.rowIds))
    : data;
  return { ...draw, data: raw, marks: ctx.m };
}

/** The preview's draws for a box / bar render (see the module header). */
export function previewStatDraws(
  render: SpecRender,
  spec: PlotSpec | null | undefined,
  datasets: readonly Dataset[],
  marksByMode: StatMarksByMode,
): PreviewStatDraws {
  if (render.kind !== "box" && render.kind !== "bar") return { flat: null, facets: null };
  const dsId = spec ? specDatasetId(spec) : null; // specToRender's own dataset
  const ds = dsId !== null ? datasets.find((d) => d.id === dsId) : undefined;
  const view = ds ? analysisView(ds) : null;
  const mode = render.kind === "bar" ? "bar" : render.violin ? "violin" : "box";
  const groupCol = spec && ds ? specGroupCol(spec, ds) : null;
  const ctx: Ctx | null = spec && ds
    ? { groupCol, yChannels: spec.zones.y.map((y) => y.channel), m: stageMarks(mode, marksByMode[mode], groupCol != null) }
    : null;
  const flatSrc = view?.data ? { data: view.data, rowIds: view.rowIds } : null;
  const facetCol = spec?.zones.facet?.channel ?? null;
  const slices = new Map<string, FacetSlice>(
    flatSrc && facetCol != null ? facetSlices(flatSrc.data, facetCol).map((s) => [s.label, s] as const) : [],
  );
  const sliceSrc = (label: string): Source | null => {
    const s = slices.get(label);
    return s ? { data: s.data, rowIds: facetSliceRowIds(s, flatSrc?.rowIds ?? null) } : null;
  };
  const panelCtx = ctx && { ...ctx, m: facetMarks(ctx.m) };
  if (render.kind === "box") {
    // A violin's KDE input: specToRender's own groups, per draw.
    const groupsOf = (src: Source | null) =>
      src && ctx ? resolveGroups(src.data, ctx.groupCol, ctx.yChannels[0], ctx.yChannels).filter((g) => g.values.length > 0) : [];
    return {
      flat: boxDraw(render, render.boxes, flatSrc, ctx),
      facets: render.facets?.map((f) => ({ label: f.label, draw: boxDraw(render, f.boxes, sliceSrc(f.label), panelCtx) })) ?? null,
      ...(render.violin && ctx
        ? { violin: { flat: groupsOf(flatSrc), facets: render.facets?.map((f) => groupsOf(sliceSrc(f.label))) ?? [] } }
        : {}),
    };
  }
  return {
    flat: barDraw(render, render.data, flatSrc, ctx),
    facets: render.facets?.map((f) => ({ label: f.label, draw: barDraw(render, f.data, sliceSrc(f.label), panelCtx) })) ?? null,
  };
}
