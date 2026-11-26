// The point labels of one figure (gap audit 8, LBL), from a PlotView + dataset.
// `pointLabelLayoutFor` is called by the live canvas (Stage/usePointLabelLayout)
// and by `buildFigureSpec` (`pointLabelsOverride`), with the same view fields, so
// both run `layoutPointLabels` on the same inputs; the export draws exactly the
// returned list (`overrides.point_labels`, `calc/figure_point_labels.py`).

import type { FigureOverrides } from "./figureOverrides";
import { layoutMessage, layoutPointLabels } from "./pointLabelLayout";
import { NO_LABELS, type LabelLayout } from "./pointLabelText";
import type { PointLabels } from "./pointLabels";
import type { PlotView } from "./plotview";
import { droppedRows } from "./rowstate";
import { shownCurves } from "./shownCurves";
import { useApp } from "../store/useApp";
import type { Dataset } from "./types";

type LabelView = Pick<
  PlotView,
  "xKey" | "yKeys" | "y2Keys" | "seriesOrder" | "hiddenChannels" | "seriesStyles" | "xScale" | "yScale" | "waterfall" | "waterfallDx" | "facetKey"
> & { exchangeXY?: boolean };

export interface LabelContext {
  /** The LIVE dataset (data, roles, designations, exclusions, filter), or null for a frozen figure (its snapshot, nothing dropped). */
  dataset: Dataset | null;
  /** The figure's own data when `dataset` is null. */
  data?: Dataset["data"];
  roles?: Dataset["channelRoles"];
  view: LabelView;
  spec: PointLabels | null | undefined;
  groupKey: number | null | undefined;
  encoding: object | undefined;
  /** Rows selected in the worksheet for THIS dataset (read by "selected rows"). */
  selected: readonly number[] | null;
}

/** The layout for `ctx`: the empty layout when labels are off. */
export function pointLabelLayoutFor(ctx: LabelContext): LabelLayout {
  const { spec, view } = ctx;
  const data = ctx.dataset?.data ?? ctx.data;
  if (!spec || !data) return NO_LABELS;
  const roles = ctx.dataset?.channelRoles ?? ctx.roles;
  const channels = shownCurves(data, view, roles);
  const styles = channels.map((c) => view.seriesStyles[c]);
  const layout = layoutPointLabels({
    dataset: { data, columnDesignations: ctx.dataset?.columnDesignations },
    dropped: ctx.dataset ? droppedRows(ctx.dataset) : new Set<number>(),
    xKey: view.xKey,
    channels,
    logOffset: view.yScale === "log" && styles.some((s) => !!s?.logOffset),
    view: {
      xScale: view.xScale,
      yScale: view.yScale,
      exchangeXY: !!view.exchangeXY,
      waterfall: view.waterfall ?? 0,
      waterfallDx: view.waterfallDx ?? 0,
      horizontalBars: Object.values(view.seriesStyles).some((s) => s?.bars === "horizontal"),
      split:
        ctx.groupKey != null || view.facetKey != null || (view.y2Keys?.length ?? 0) > 0 ||
        (!!ctx.encoding && Object.keys(ctx.encoding).length > 0),
    },
    spec,
    selected: ctx.selected ? new Set(ctx.selected) : null,
  });
  return spec.avoid ? { ...layout, avoid: spec.avoid } : layout;
}

/** `ov` plus `point_labels` when the figure labels any point (never with x
 *  breaks, whose broken panels draw none on screen either). */
export function pointLabelsOverride(
  ov: FigureOverrides | undefined,
  ctx: Omit<LabelContext, "selected">,
  breaks: boolean,
): FigureOverrides | undefined {
  if (!ctx.spec || breaks) return ov;
  const sel = useApp.getState().selection;
  const selected = ctx.spec.mode === "selected" && ctx.dataset && sel?.datasetId === ctx.dataset.id ? sel.rows : null;
  // "Selected rows" with no selection (or a saved figure, which has no worksheet) labels nothing and
  // prints no "select rows" hint: that note is for the live plot, not for a figure.
  if (ctx.spec.mode === "selected" && !selected?.length) return ov;
  const layout = pointLabelLayoutFor({ ...ctx, selected });
  const note = layoutMessage(layout);
  if (layout.points.length === 0 && !note) return ov;
  const { avoid } = ctx.spec;
  return {
    ...ov,
    point_labels: {
      points: layout.points.map(({ x, y, text, s }) => ({ x, y, text, s })),
      ...(note ? { note } : {}),
      // Plan item 18: the export places the labels itself (calc.label_placement), with its own text metrics.
      ...(avoid ? { avoid: { leader_distance: avoid.leaderDistance, leader_width: avoid.leaderWidth, leader_dashed: avoid.leaderDashed } } : {}),
    },
  };
}
