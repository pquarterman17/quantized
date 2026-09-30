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
//   * the same columns as the render (`lib/plotEncodingStat.statPlan`: the X
//     category, nested or replaced by a Color pick, whose levels colour the
//     glyphs — `lib/statColor`; otherwise `plotspecGroupCol.specGroupCol`,
//     the first Y as the value, every Y as a bar series).
//
// A violin's box draw carries the violin's marks, plus its groups
// (`violin`), from which `./usePreviewViolins` fetches the KDE the Stat Stage
// draws; the box stands in until then, or when the backend is unreachable.
// No spec (or no dataset) = the unmarked draws the preview always made.

import { facetSlices, facetSliceRowIds, type FacetSlice } from "../../../lib/facet";
import { specDatasetId, type PlotSpec, type SpecRender } from "../../../lib/plotspec";
import { barLevels, groupLevels, planColor, statPlan, type StatPlan } from "../../../lib/plotEncodingStat";
import type { StatMarksByMode } from "../../../lib/plotviewSanitize";
import { analysisView } from "../../../lib/rowstate";
import type { StatColor } from "../../../lib/statColor";
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
  /** The axis (`lib/plotEncodingStat.statPlan`: a Color pick may nest it). */
  plan: StatPlan;
  yChannels: number[];
  m: ResolvedStatMarks;
  /** P1.4 Color-by: the factor whose level colours each glyph. */
  color: StatColor | null;
  nestLabel: string | null;
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
    const { groupCol, group2Col } = ctx.plan;
    points = resolveGroupsIndexed(src.data, groupCol, ctx.yChannels[0], ctx.yChannels, group2Col, src.rowIds)
      .filter((g) => g.points.length > 0);
  }
  const colorLevels = src && ctx.color ? groupLevels(src.data, ctx.plan, ctx.yChannels[0], ctx.color) : null;
  const nest = ctx.nestLabel ? { nestLabel: ctx.nestLabel } : {};
  return { ...draw, points, marks: ctx.m, ...nest, ...(colorLevels ? { colorLevels } : {}) };
}

function barDraw(
  r: Extract<StatRender, { kind: "bar" }>,
  data: Extract<StatRender, { kind: "bar" }>["data"],
  src: Source | null,
  ctx: Ctx | null,
): StatDrawData {
  const draw: StatDrawData = { mode: "bar", data, valueLabel: r.valueLabel, groupLabel: r.groupLabel, stacked: r.stacked };
  if (!ctx) return draw;
  const { groupCol } = ctx.plan;
  const raw = src && needsBarRaw(ctx.m)
    ? withBarRaw(data, barCellPoints(src.data, groupCol, ctx.yChannels, ctx.yChannels[0], ctx.yChannels, src.rowIds))
    : data;
  const colorLevels = src && ctx.color && groupCol !== null ? barLevels(src.data, groupCol, ctx.color) : null;
  return { ...draw, data: raw, marks: ctx.m, ...(colorLevels ? { colorLevels } : {}) };
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
  const plan = spec && ds ? statPlan(spec, ds) : null;
  const ctx: Ctx | null = spec && ds && plan
    ? {
        plan,
        yChannels: spec.zones.y.map((y) => y.channel),
        m: stageMarks(mode, marksByMode[mode], plan.groupCol != null),
        color: planColor(plan, ds),
        nestLabel: plan.group2Col === null ? null : (ds.data.labels[plan.group2Col] ?? null),
      }
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
      src && ctx
        ? resolveGroups(src.data, ctx.plan.groupCol, ctx.yChannels[0], ctx.yChannels, ctx.plan.group2Col)
            .filter((g) => g.values.length > 0)
        : [];
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
