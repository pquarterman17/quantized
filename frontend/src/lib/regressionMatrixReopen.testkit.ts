// P4.2 canonical plot/project regression matrix — the REOPEN leg.
//
// Split out of `regressionMatrixLegs.testkit.ts` (2026-09-14 review round):
// that file sat at 486 of the 500-line `.ts` module ceiling
// (`architecture.test.ts`), and this round adds a per-level screen-style
// reader to its screen leg. The screen and export legs stay together there;
// this file owns the persistence round trip and the projection of what came
// back out of it.
//
// What this leg reads: the `FigureDocument` (and, for the page fixture, the
// `PageDocument`) that comes back out of the REAL project persistence
// boundary, `serializeWorkspace` -> `parseWorkspace`. It projects from the
// reopened document's OWN fields — bindings + plot.view + publication — and
// deliberately never calls `buildOpts` or `buildFigureSpecFromDocument`, which
// would only prove those builders are deterministic. A field that survives the
// round trip in name but not in meaning still shows up here as a difference.

import { buildErrorSpans, type ErrorSpan } from "./errorbars";
import { figureDocumentToPlotView, type FigureDocument } from "./figureDocument";
import type { PageDocument } from "./pageDocument";
import { buildColumns, composeDisplayPayload, dropTrailingEmptyRows, effectiveChannels } from "./plotdata";
import { resolveSeriesStyle, seriesColor } from "./seriesStyleCycle";
import { parseWorkspace, serializeWorkspace, type WorkspaceState } from "./workspace";
import type { Dataset, DataStruct } from "./types";
import {
  canonicalErrorsFromSpans,
  dashOf,
  decorOf,
  displayLabel,
  facetOf,
  figureMode,
  groupingOf,
  limitsOf,
  markerOf,
  measureWaterfall,
  styleComparable,
  type CanonicalFigure,
  type CanonicalSeries,
} from "./regressionMatrix.testkit";

export interface ReopenedProject {
  /** EVERY reopened figure, in the order handed to `reopenProject` (widened
   *  2026-09-14: the page fixture used to round-trip only panel 0 and keep the
   *  other three in-memory documents, so three of its four panel identities
   *  were asserting nothing about persistence). */
  figures: FigureDocument[];
  /** The first reopened figure — the single-figure legs' subject.
   *
   *  Named `figure`, not `document`: `architecture.test.ts`'s F1 chokepoint
   *  guard reads a brace- or comma-preceded `document:` in any source module
   *  as a canonical PlotWindow.document write, and this testkit is a source
   *  module. */
  figure: FigureDocument;
  dataset: Dataset;
  page: PageDocument | null;
}

/** Round-trip one or more figures (and, when given, a page referencing them)
 *  through the REAL project persistence boundary. Throws if a document or the
 *  dataset does not survive at all — silently returning a default would hide
 *  the failure this leg exists to catch. */
export function reopenProject(
  figures: FigureDocument | readonly FigureDocument[],
  dataset: Dataset,
  page?: PageDocument,
): ReopenedProject {
  const input = Array.isArray(figures) ? [...(figures as readonly FigureDocument[])] : [figures as FigureDocument];
  const state: WorkspaceState = {
    datasets: [dataset],
    activeId: dataset.id,
    editableFigures: input,
    ...(page ? { pages: [page] } : {}),
  };
  const loaded = parseWorkspace(serializeWorkspace(state), { width: 1280, height: 800 });
  const reopenedDataset = loaded.datasets.find((d) => d.id === dataset.id);
  if (!reopenedDataset) throw new Error(`dataset "${dataset.id}" did not survive the workspace round trip`);
  const reopened = input.map((wanted) => {
    const found = loaded.editableFigures.find((f) => f.id === wanted.id);
    if (!found) throw new Error(`figure "${wanted.id}" did not survive the workspace round trip`);
    return found;
  });
  return {
    figures: reopened,
    figure: reopened[0],
    dataset: reopenedDataset,
    page: page ? (loaded.pages.find((p) => p.id === page.id) ?? null) : null,
  };
}

/** Project a REOPENED figure from the persisted document's own fields. */
export function projectReopen(reopened: ReopenedProject): CanonicalFigure {
  const { figure, dataset } = reopened;
  const mode = figureMode(figure);
  const view = figureDocumentToPlotView(figure);
  const data: DataStruct = figure.data.mode === "frozen" ? figure.data.snapshot! : dataset.data;
  const groupCol = mode === "group" ? figure.bindings.groupKey : null;

  const displayChannels = effectiveChannels(
    data, view.yKeys, view.xKey, dataset.channelRoles, view.seriesOrder,
  );
  const drawnChannels = displayChannels.filter((ch) => !view.hiddenChannels.includes(ch));
  const y2 = new Set(figure.bindings.y2Keys ?? []);
  const comparableStyle = styleComparable(mode);

  const series: CanonicalSeries[] = drawnChannels.map((ch) => {
    // The DISPLAY position — this channel's slot in the UNFILTERED list, which
    // is the index space a renderer resolves the palette in (a hidden series
    // keeps its slot on the canvas, and since BUG-015 on the export wire too).
    // Indexing the hidden-filtered list instead was the same skew, here.
    const i = displayChannels.indexOf(ch);
    const style = resolveSeriesStyle(view.seriesStyles[ch], i, null);
    return {
      channel: ch,
      label: view.seriesLabels[ch] ?? displayLabel(data.labels, data.units, ch),
      unit: data.units[ch] ?? "",
      axis: y2.has(ch) ? 1 : 0,
      // The palette is a render-time decision from the DISPLAY POSITION; what
      // the persisted document contributes is the override (or its absence).
      // `seriesColor` is the shared resolver both other legs also bottom out
      // in — not the screen or export builder — so this stays independent
      // evidence about what was saved.
      color: comparableStyle.color ? seriesColor(i, style) : null,
      width: comparableStyle.shape ? (style?.width ?? null) : null,
      dash: comparableStyle.shape ? dashOf(style?.line) : null,
      marker: comparableStyle.shape ? markerOf(style) : null,
      step: comparableStyle.shape ? (style?.step ?? null) : null,
      fill: comparableStyle.shape && style?.fill && style.fill !== "none"
        ? (style.fill === "under" ? "under" : `vs:${style.fill.vs}`)
        : null,
    };
  });

  const spans: Map<number, ErrorSpan[]> =
    groupCol !== null ? new Map() : buildErrorSpans(data, drawnChannels, figure.bindings.errors);

  return {
    mode,
    xBinding: figure.bindings.xKey,
    series,
    errors: canonicalErrorsFromSpans(spans, drawnChannels.length),
    grouping: groupingOf(data, groupCol),
    facet: facetOf(data, figure.bindings.facetKey, view.xKey, view.yKeys),
    y2Positions: series.flatMap((s, i) => (s.axis === 1 ? [i] : [])),
    xBreaks: figure.plot.axisBreaks.x.map((r) => [r[0], r[1]] as [number, number]),
    waterfallOffset: waterfallOffsetFor(data, view.waterfall, view.y2Keys, view.xKey, displayChannels),
    axes: {
      x: { label: view.xAxisLabel || null, scale: view.xScale, limits: limitsOf(view.xLim) },
      y: { label: view.yAxisLabel || null, scale: view.yScale, limits: limitsOf(view.yLim) },
      y2: series.some((s) => s.axis === 1)
        ? {
            label: view.y2AxisLabel || null,
            scale: view.y2Scale ?? view.yScale,
            limits: limitsOf(view.y2Lim),
          }
        : null,
    },
    decor: decorOf(view),
  };
}

/** The offset a reopened figure's data WOULD carry, measured over the SAME
 *  columns the EXPORT leg's fallback measures
 *  (`waterfallOffset.canvasColumns`), through the SCREEN leg's own
 *  `measureWaterfall` — not read off the persisted field — so all three legs
 *  compare the same quantity in the same units.
 *
 *  BUG-013 round 4, NIT 5 (round 5 review, NIT 5: reworded — the opening line
 *  used to say "measured the same way the screen leg measures it", which the
 *  paragraph below then contradicted): `dropTrailingEmptyRows` wraps
 *  `buildColumns` here because the EXPORT leg's own fallback does too —
 *  without it, a padded fixture would report a false `reopen != export`
 *  divergence purely from measuring over a longer, un-dropped tail. The
 *  SCREEN leg's own mirror omits this step, documented as a no-op for every
 *  current matrix fixture (`regressionMatrix.testkit.ts`'s KNOWN LIMITS) —
 *  it mirrors `usePlotPayload`'s pre-fetch-resolution shape, not the fetched
 *  payload `dropTrailingEmptyRows` runs on. A future padded fixture would
 *  therefore surface as screen != {export, reopen}, not a hidden gap: the
 *  matrix compares all three legs, and the screen leg's own KNOWN LIMITS
 *  entry already says so. */
function waterfallOffsetFor(
  data: DataStruct,
  waterfall: number,
  y2Keys: number[] | null,
  xKey: number | null,
  channels: number[],
): number {
  const base = dropTrailingEmptyRows(buildColumns(data, y2Keys, xKey, channels));
  const offset = composeDisplayPayload(base, {
    id: null,
    waterfall,
    dropped: new Set<number>(),
    excludedDisplay: "hide",
    fitOverlay: null,
    baselineOverlay: null,
    peakOverlay: null,
    derivOverlay: null,
    selection: null,
  });
  return measureWaterfall(base, offset);
}
