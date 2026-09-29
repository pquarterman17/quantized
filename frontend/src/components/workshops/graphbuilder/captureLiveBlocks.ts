// #12 Slice 3 ("Capture on save"), extended by "part C" to also fold in
// decor: fold the LIVE display/axes/decor state into the spec being saved.
// Moved verbatim out of useGraphBuilder.ts (PRIMARY_SOFTWARE_AUDIT_PLAN P1.4),
// whose `architecture.test.ts` pin had zero headroom for the encoding wells —
// it was already a pure function of the spec and one store read.
//
// store/graphBuilder.ts stays dumb (it persists whatever PlotSpec it's handed)
// — useGraphBuilder is the one place that holds both the spec and the live
// store, so it's the only caller. Scoped to the spec's OWN plotted channels
// (zones.y ∪ zones.x): seriesStyles/hiddenChannels/y2Keys/the axis singleton
// fields are the store's CURRENT-PLOT state (per-window, not per-dataset — see
// useApp's `restoredView` hydration), so they only describe whichever dataset
// is presently ACTIVE. A spec bound to a different (non-active) dataset — the
// #8i "worksheet handoff to a non-active dataset" case — has no live state to
// read here at all, so it saves zones-only, exactly like every save before
// this slice. Blocks are recomputed FRESH from the live store on every save
// (never merged with whatever blocks the spec carried IN, e.g. from a reopened
// v2 spec — see openSpec's doc): those blocks were never applied back to the
// live store anyway (that's Slice 5), so they're stale the moment the user
// touches anything, and a resave legitimately reflects the CURRENT plot, not
// the old saved one. `zones` rides through whole, so the P1.4 encoding zones
// (color/symbol/label) are saved with the rest.

import type { StoreGet } from "../../../lib/exportActive";
import { specDatasetId, type PlotSpec } from "../../../lib/plotspec";
import { buildAxesBlock, buildDecorBlock, buildDisplayBlock, buildPageBlock } from "../../../lib/plotspec2";

export function captureLiveBlocks(base: PlotSpec, getState: StoreGet): PlotSpec {
  const dsId = specDatasetId(base);
  const s = getState();
  if (dsId === null || dsId !== s.activeId) return base;
  const yChannels = base.zones.y.map((r) => r.channel);
  const xChannel = base.zones.x?.channel;
  const plotted = [...new Set(xChannel !== undefined ? [xChannel, ...yChannels] : yChannels)];
  // The active dataset's column labels (dsId === s.activeId is guaranteed
  // above) — captured so a re-applied spec can re-key by label if the
  // columns shift later (see plotspecApply.applyDisplayBlock).
  const channelLabels = s.datasets.find((d) => d.id === dsId)?.data.labels ?? [];
  const display = buildDisplayBlock(
    s.seriesStyles,
    plotted,
    s.y2Keys,
    s.hiddenChannels,
    s.seriesOrder,
    channelLabels,
  );
  const axes = buildAxesBlock({
    title: s.plotTitle,
    xLabel: s.xAxisLabel,
    yLabel: s.yAxisLabel,
    y2Label: s.y2AxisLabel,
    xLim: s.xLim,
    yLim: s.yLim,
    y2Lim: s.y2Lim,
    xScale: s.xScale,
    yScale: s.yScale,
    y2Scale: s.y2Scale,
    xStep: s.xStep,
    yStep: s.yStep,
    xFmt: s.xFmt,
    yFmt: s.yFmt,
    y2Fmt: s.y2Fmt,
  });
  // "part C": annotations/shapes are GLOBAL plot overlays (not
  // channel-scoped), so — unlike display — they're captured verbatim, not
  // filtered against `plotted`.
  const decor = buildDecorBlock(s.annotations, s.shapes, {
    pos: s.legendPos,
    xy: s.legendXY,
    title: s.legendTitle,
  });
  // #54 pass C: the page state a spec would otherwise lose on save/reopen —
  // the page size a figure was composed at, its fit mode, and whether it
  // was stacked. All-default captures to `undefined` (an ordinary flat plot
  // never flips to v2).
  const page = buildPageBlock({
    stackMode: s.stackMode,
    panelFit: s.panelFit,
    pageSetup: s.pageSetup,
  });
  return {
    version: display || axes || decor || page ? 2 : 1,
    zones: base.zones,
    mark: base.mark,
    // GAP_PLOTTYPES: these are byte-stable v1 siblings of `mark` (see
    // PlotSpec's doc), not derived from live store state — carried
    // straight from the BUILDER's own spec (same as zones/mark above), so
    // a saved "step" recipe still knows its alignment/marker toggle on
    // reopen even though the display block below only ever captures the
    // per-CHANNEL style, not this spec-level default.
    ...(base.stepMode ? { stepMode: base.stepMode } : {}),
    ...(base.showMarkers ? { showMarkers: base.showMarkers } : {}),
    ...(display ? { display } : {}),
    ...(axes ? { axes } : {}),
    ...(page ? { page } : {}),
    ...(decor ? { decor } : {}),
  };
}
