/**
 * Characterization-only census for the figure-authoring models.
 *
 * This is deliberately not a converter or a new persistence schema. It freezes
 * the current top-level contracts before F1 introduces FigureDocument. The
 * `satisfies` clauses make a model change fail type-checking until its ownership
 * is classified here.
 */
import type { FigureSpec } from "./api";
import type { FigureConfig, FigureDoc } from "./figuredoc";
import type { PlotSpec } from "./plotspec";
import type { PlotView } from "./plotview";

export type FigureFieldClass =
  | "canonical"
  | "recipe-only"
  | "export-only"
  | "derived"
  | "unsupported";

export interface FigureFieldContract {
  classification: FigureFieldClass;
  /** Intended FigureDocument path, or null when the field must not be stored there. */
  mapsTo: string | null;
  reason: string;
}

type FieldContractMap<T> = { [K in keyof T]-?: FigureFieldContract };

const field = (
  classification: FigureFieldClass,
  mapsTo: string | null,
  reason: string,
): FigureFieldContract => ({ classification, mapsTo, reason });

const canonical = (mapsTo: string, reason = "Persist the editable value losslessly.") =>
  field("canonical", mapsTo, reason);
const recipe = (mapsTo: string, reason = "Apply as a reusable construction rule, not document identity.") =>
  field("recipe-only", mapsTo, reason);
const derived = (mapsTo: string | null, reason = "Generate from canonical document state.") =>
  field("derived", mapsTo, reason);
const output = (mapsTo: string, reason = "Persist only as an output preference.") =>
  field("export-only", mapsTo, reason);
const unsupported = (reason: string) => field("unsupported", null, reason);

/** PlotView is the richest current editable state and the starting canonical owner. */
export const PLOT_VIEW_FIELD_CONTRACT = {
  yScale: canonical("axes.y.scale"),
  xScale: canonical("axes.x.scale"),
  showGrid: canonical("axes.grid.visible"),
  showLegend: canonical("legend.visible"),
  legendPos: canonical("legend.presetPosition"),
  legendXY: canonical("legend.plotPosition"),
  legendFrameXY: canonical("legend.framePosition"),
  legendStatic: canonical("legend.static"),
  legendTitle: canonical("legend.title"),
  axisLabelOffsets: canonical("axes.labelOffsets"),
  axisLabelStyles: canonical("axes.labelStyles"),
  plotTemplate: canonical("style.templateId", "Keep the selected template identity without reapplying it over later edits."),
  showAxisBox: canonical("axes.box.visible"),
  stackMode: canonical("plot.stack.enabled"),
  insetMode: canonical("plot.inset.enabled"),
  polarMode: canonical("plot.coordinateSystem", "Represent the current polar mode as an explicit coordinate system."),
  statMode: canonical("plot.statMode"),
  xLim: canonical("axes.x.limits"),
  yLim: canonical("axes.y.limits"),
  xStep: canonical("axes.x.step"),
  yStep: canonical("axes.y.step"),
  xFmt: canonical("axes.x.format"),
  yFmt: canonical("axes.y.format"),
  y2Fmt: canonical("axes.y2.format"),
  plotTitle: canonical("title.text"),
  xAxisLabel: canonical("axes.x.label"),
  yAxisLabel: canonical("axes.y.label"),
  xKey: canonical("bindings.x.channel"),
  yKeys: canonical("bindings.y.channels"),
  groupKey: canonical(
    "bindings.group.channel",
    "P1.5: the live facade's own copy of the durable group-split binding -- see figureDocument.ts's figureDocumentToPlotView/updateFigureDocumentFromPlotView.",
  ),
  y2Keys: canonical("bindings.y2.channels"),
  y2Lim: canonical("axes.y2.limits"),
  y2Scale: canonical("axes.y2.scale"),
  y2Step: canonical("axes.y2.step"),
  y2AxisLabel: canonical("axes.y2.label"),
  refLines: canonical("decor.referenceLines"),
  annotations: canonical("decor.annotations"),
  regionShades: canonical("decor.regionShades"),
  shapes: canonical("decor.shapes"),
  seriesStyles: canonical("series.styles"),
  seriesLabels: canonical("series.labels"),
  errKeys: canonical("bindings.errors"),
  seriesOrder: canonical("series.order"),
  hiddenChannels: canonical("series.hiddenChannels"),
  waterfall: canonical("plot.waterfall.verticalOffset"),
  panelFit: canonical("page.panelFit"),
  pageSetup: canonical("page.setup"),
} satisfies FieldContractMap<PlotView>;

/** PlotSpec remains a reusable recipe whose blocks populate a FigureDocument. */
export const PLOT_SPEC_FIELD_CONTRACT = {
  version: derived(null, "Schema metadata is owned by the recipe serializer."),
  zones: recipe("bindings"),
  mark: recipe("plot.mark"),
  stepMode: recipe(
    "series",
    "Baked into each Y series' `step` override when the spec commits (useGraphBuilder's markSeriesStyle), not stored as separate document identity.",
  ),
  showMarkers: recipe(
    "series",
    "Baked into each Y series' `marker` override when the spec commits (useGraphBuilder's markSeriesStyle), not stored as separate document identity.",
  ),
  display: recipe("series"),
  axes: recipe("axes"),
  page: recipe("page"),
  decor: recipe("decor"),
} satisfies FieldContractMap<PlotSpec>;

/** FigureConfig is a legacy publication projection, not a second authority. */
export const FIGURE_CONFIG_FIELD_CONTRACT = {
  xKey: derived("bindings.x.channel"),
  yKeys: derived("bindings.y.channels"),
  groupCol: derived("bindings.group.channel"),
  xScale: derived("axes.x.scale"),
  yScale: derived("axes.y.scale"),
  title: derived("title.text"),
  xLabel: derived("axes.x.label"),
  yLabel: derived("axes.y.label"),
  style: output("output.stylePreset"),
  fmt: output("output.format"),
  dpi: output("output.dpi"),
  overrides: derived(null, "Flatten canonical axes, legend, decor, and page state only at render time."),
  seriesStyles: derived("series.styles"),
  errors: derived(
    "bindings.errors",
    "Graph Builder's Y-error/X-error wells, threaded into FigureDocument.bindings.errors when opening Publication Preview -- independent of Dataset.errorRoles, since the wells may not be committed to the dataset yet.",
  ),
} satisfies FieldContractMap<FigureConfig>;

/** Preserve FigureDoc identity/freeze semantics while its config becomes a projection. */
export const FIGURE_DOC_FIELD_CONTRACT = {
  id: canonical("id", "Stable identity for save, update, links, and page references."),
  name: canonical("name"),
  datasetId: canonical("bindings.datasetId"),
  config: derived(null, "Legacy FigureConfig is generated from the canonical document during migration."),
  live: canonical("data.mode", "Preserve whether bindings are live or frozen."),
  dataSnapshot: canonical("data.snapshot", "A frozen document must remain renderable without its source dataset."),
} satisfies FieldContractMap<FigureDoc>;

/** FigureSpec is a one-way backend request assembled from document + output options. */
export const FIGURE_SPEC_FIELD_CONTRACT = {
  dataset: derived(null, "Resolve or snapshot bound data when building the render request."),
  x_key: derived("bindings.x.channel"),
  y_keys: derived("bindings.y.channels"),
  x_log: unsupported("Legacy wire fallback; derive x_scale instead of storing a duplicate boolean."),
  y_log: unsupported("Legacy wire fallback; derive y_scale instead of storing a duplicate boolean."),
  x_scale: derived("axes.x.scale"),
  y_scale: derived("axes.y.scale"),
  x_fmt: derived("axes.x.format"),
  y_fmt: derived("axes.y.format"),
  x_step: derived("axes.x.step"),
  y_step: derived("axes.y.step"),
  y2_keys: derived("bindings.y2.channels"),
  y2_label: derived("axes.y2.label"),
  y2_scale: derived("axes.y2.scale"),
  y2_fmt: derived("axes.y2.format"),
  y2_step: derived("axes.y2.step"),
  group_col: derived("bindings.group.channel"),
  fmt: output("output.format"),
  style: output("output.stylePreset"),
  dpi: output("output.dpi"),
  transparent: output("output.transparent"),
  error_spans: derived("bindings.errors"),
  width_in: output("output.widthIn"),
  height_in: output("output.heightIn"),
  title: derived("title.text"),
  x_label: derived("axes.x.label"),
  y_label: derived("axes.y.label"),
  series_styles: derived("series.styles"),
  overrides: derived(null, "Flatten canonical axes, legend, decor, and page state only at render time."),
  filename: output("output.filename"),
} satisfies FieldContractMap<FigureSpec>;

export const FIGURE_FIELD_CONTRACTS = {
  PlotView: PLOT_VIEW_FIELD_CONTRACT,
  PlotSpec: PLOT_SPEC_FIELD_CONTRACT,
  FigureConfig: FIGURE_CONFIG_FIELD_CONTRACT,
  FigureDoc: FIGURE_DOC_FIELD_CONTRACT,
  FigureSpec: FIGURE_SPEC_FIELD_CONTRACT,
} as const;
