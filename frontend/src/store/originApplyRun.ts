// The Origin-figure APPLY BODY (bundle headroom slice 18,
// `plans/BUNDLE_HEADROOM.md`): everything `applyOriginFigure` does once its
// three preflights have passed, moved verbatim out of store/viewAppliers.ts.
//
// It is loaded in the same `Promise.all` as the apply-only figure libraries
// (`store/originApplyLibs.ts`), so it reaches the store only through the
// namespace `originApplyLibs()` returns. Until that load lands the action
// takes the existing `deferOriginApplyLibs` preflight, exactly as it did
// before; afterwards this body runs synchronously, one undo step and one
// macro step per apply. A load that fails here fails that same preflight,
// which reports it and mutates nothing.
//
// NOTE: nothing reachable from the entry chunk may import this module
// statically, or the bundler folds it back into the eager graph
// (`src/architecture.test.ts`'s SEAMS list is the guard).

import { spatialComposition } from "../lib/composition";
import { lit } from "../lib/macro";
import { figureLabel, figureLayerFamily, type OriginFigureEntry } from "../lib/originFigures";
import { buildOverlayDataset, originOverlayDataset, overlayCurveLabels, overlayCurveStyles } from "../lib/originOverlayFigure";
import { pageSetupFromDecoded } from "../lib/pageGeometry";
import { dedupeWindowTitle, displayedWindowTitle, scaleFromLog } from "../lib/plotview";
import { nextDatasetId } from "./idSeq";
import type { OriginApplyLibs } from "./originApplyLibs";
import { toast } from "./toasts";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

// Origin figures apply boxed + gridless (item 4; grid undecodable) — Origin's clean look, ticks still draw, user re-enables.
// Origin figures apply gridless + boxed + a clean read-only legend (decode
// #52); every apply branch spreads this, so `legendStatic` costs zero lines.
const ORIGIN_FIGURE_AXIS = { showAxisBox: true, showGrid: false, legendStatic: true };

/** Apply `entry` (figure `id`) to the store. Callers have already run every
 *  preflight and hold the loaded `libs`; `label` is the undo label the
 *  caller's one-edit-step wrapper uses. */
export function runOriginFigureApply(
  set: SliceSet,
  get: SliceGet,
  label: string,
  entry: OriginFigureEntry & { datasetId: string },
  id: string,
  opts: { newWindow?: boolean } | undefined,
  libs: OriginApplyLibs,
): void {
  // Past every preflight: the apply happens now, as ONE undo step (the
  // wrapper below folds a new window's and a new overlay's own entries in).
  get().recordHistory(label);
  // Item 9: open a NEW window for this figure instead of overwriting the
  // focused one. Creating (bound to the figure's dataset) then focusing
  // BEFORE any of the apply logic below runs means every `setActive`/
  // singleton `set()` call further down — already scoped to "the focused
  // window" by construction — lands on this new window. Title comes from
  // the figure's own label (deduped against what's already showing), per
  // item 9's "window title from figureLabel / doc name".
  if (opts?.newWindow) {
    const s = get();
    const title = dedupeWindowTitle(
      figureLabel(entry),
      s.plotWindows.map((w) => displayedWindowTitle(w, s.datasets)),
    );
    const winId = s.createWindow(entry.datasetId, undefined, title);
    s.focusWindow(winId);
  }
  const fig = entry.figure;
  // Cross-book figures (curves spanning ≥2 workbooks) materialize as an
  // overlay dataset (owner decision) so the combined graph Origin showed is
  // reproduced in one plot; re-applying reuses the existing overlay.
  const overlayName = `${entry.stem}:${figureLabel(entry)} (overlay)`;
  // Scope overlay resolution to THIS import's datasets: Origin's default book
  // names (Book1/Book2/…) repeat across separate projects, so resolving
  // against every dataset in the store would silently combine the wrong
  // books. Reuse is keyed on the entry id (not the display name, which can
  // collide across same-stem imports) so re-applying reuses only this
  // figure's own overlay.
  const siblings = get().datasets.filter((d) => entry.siblingIds.includes(d.id));
  const existing = get().datasets.find((d) =>
    (d.data.metadata ?? {}).origin_overlay_source === entry.id);
  const overlay = buildOverlayDataset(fig, siblings);
  if (overlay) {
    const targetId = existing?.id ?? nextDatasetId();
    const refreshed = originOverlayDataset(targetId, overlayName, overlay, entry.id, existing);
    if (existing) {
      set((s) => ({
        datasets: s.datasets.map((d) =>
          d.id === existing.id ? refreshed : d
        ),
      }));
    } else {
      get().addDataset(refreshed);
      toast(`built overlay — ${overlay.labels.length} curves`, "ok");
    }
    if (targetId) {
      get().setActive(targetId);
      const src = refreshed.data;
      const n = src?.labels.length ?? 0;
      set({
        // F4.4 review L1: every branch below that installs a plot onto an
        // ALREADY-active dataset must clear the durable `facetKey`
        // binding explicitly -- `setActive` only resets it on a GENUINE
        // dataset switch (`datasetViewDefaults`), so re-applying a figure
        // onto the dataset that's already showing would otherwise leave a
        // prior `facetByColumn`'s binding in place, and a later focus
        // round-trip would resurrect that REPLACED facet grid instead of
        // this plain/spatial one (`useEffectiveComposition`'s fallback).
        // `composition` itself needs no matching explicit clear here --
        // `setActive`'s `focusTransientReset()` already nulls it
        // UNCONDITIONALLY, genuine switch or not.
        facetKey: null,
        ...ORIGIN_FIGURE_AXIS,
        xLim: [fig.x_from, fig.x_to],
        yLim: [fig.y_from, fig.y_to],
        xStep: fig.x_step ?? null,
        yStep: fig.y_step ?? null,
        xScale: scaleFromLog(fig.x_log), // Origin's own axis type is boolean-only
        yScale: scaleFromLog(fig.y_log),
        xKey: null,
        yKeys: Array.from({ length: n }, (_, i) => i),
        // Restore each overlay column's decoded line/scatter look + legend caption.
        seriesStyles: overlayCurveStyles(src),
        seriesLabels: overlayCurveLabels(src),
        // Origin's real axis titles ("" falls back to the data-derived label).
        xAxisLabel: fig.x_title ?? "",
        yAxisLabel: fig.y_title ?? "",
        // Pin the figure's decoded floating text; REPLACE so re-applying
        // or switching figures never stacks stale marks.
        annotations: libs.originFigureAnnotations([fig], entry.id),
        // Decoded Rect* region bands (item 41) — REPLACE, same lifecycle
        // as annotations (figures without shades clear the plot's bands).
        regionShades: libs.originRegionShades([fig], entry.id),
        // Origin's legend placement -> nearest corner preset + decoded title
        // header (decode #52; position only when decoded, never guessed).
        ...libs.originLegendState(fig),
      });
      get().recordMacro(`Apply figure ${lit(fig.name)}`, `qz.applyFigure(${lit(id)})`);
      return;
    }
  }
  // Origin's double-Y idiom: a 2-layer graph window whose layers both
  // resolved to this SAME dataset. Applying either layer's entry then
  // offers the combined view Origin showed — layer-1 curves on the
  // primary Y axis, layer-2 curves on the secondary (y2) axis — instead
  // of just the clicked layer's own curves. Axis range/log come from the
  // LOWER layer number (Origin draws layer 1's axis as the "main" one).
  const partner = libs.doubleYPartner(entry, get().originFigures);
  const dsForPartner = partner ? get().datasets.find((d) => d.id === entry.datasetId) : null;
  if (partner && dsForPartner) {
    const lower = (entry.figure.layer ?? 1) <= (partner.figure.layer ?? 1) ? entry : partner;
    const upper = lower === entry ? partner : entry;
    const baseSel = libs.figureChannelSelection(lower.figure, dsForPartner);
    const partnerSel = libs.figureChannelSelection(upper.figure, dsForPartner);
    if (baseSel && partnerSel) {
      get().setActive(entry.datasetId);
      set({
        facetKey: null, // F4.4 review L1 -- see the overlay branch's doc above
        ...ORIGIN_FIGURE_AXIS,
        xLim: [lower.figure.x_from, lower.figure.x_to],
        yLim: [lower.figure.y_from, lower.figure.y_to],
        xStep: lower.figure.x_step ?? null,
        yStep: lower.figure.y_step ?? null,
        xScale: scaleFromLog(lower.figure.x_log),
        yScale: scaleFromLog(lower.figure.y_log),
        xKey: baseSel.xKey,
        // The plotted-channel list derives from yKeys ALONE (y2Keys only tags
        // which of them sit on the right axis), so yKeys must be the UNION of
        // both layers' channels (lower layer first) or layer-2's curves never
        // render. The filter also dedupes a y2 channel that overlaps primary.
        yKeys: [
          ...baseSel.yKeys,
          ...partnerSel.yKeys.filter((k) => !baseSel.yKeys.includes(k)),
        ],
        y2Keys: partnerSel.yKeys,
        // Layer 2's own axis state -> the secondary axis (13.2 #6): range,
        // log flag, and title (falls back to auto when undecoded).
        y2Lim: [upper.figure.y_from, upper.figure.y_to],
        y2Scale: scaleFromLog(upper.figure.y_log),
        y2Step: upper.figure.y_step ?? null,
        y2AxisLabel: upper.figure.y_title ?? "",
        seriesStyles: { ...baseSel.styles, ...partnerSel.styles },
        seriesLabels: { ...baseSel.labels, ...partnerSel.labels },
        xAxisLabel: lower.figure.x_title ?? "",
        yAxisLabel: lower.figure.y_title ?? "",
        // Both layers' marks (lower first) — REPLACE, never stack. The upper
        // layer's marks are tagged axis:1 so they land on y2 (fix #3), not
        // the primary axis lower.figure's own marks stay on.
        annotations: libs.originFigureAnnotations([lower.figure, upper.figure], entry.id, [0, 1]),
        // Both layers' region bands, the upper layer's tagged to y2 (item 41).
        regionShades: libs.originRegionShades([lower.figure, upper.figure], entry.id, [0, 1]),
        ...libs.originLegendState(lower.figure),
      });
      get().recordMacro(`Apply figure ${lit(fig.name)}`, `qz.applyFigure(${lit(id)})`);
      return;
    }
    // Either layer's curves didn't map to a channel — fall back below.
  }
  // Multi-panel spatial apply (decode-plan #36): ≥2 same-window layers
  // that didn't (or couldn't) combine as a Y/Y2 pair — the "Fixed Lambdas
  // SI"!Graph6-style 2-stack, or any ≥2-layer composite/panel window.
  // Arrange each layer as its OWN panel, placed per the page's real
  // spatial layout (`originFigures.resolveSpatialPanels`, which resolves
  // every layer, ALSO collapses a frame-coincident double-Y pair into one
  // merged panel before handing the rest to
  // `originPanels.computePanelLayout` — the PNR/S7/Book33 fix: a y2
  // overlay's frame used to trip the whole figure into a bogus 1xN
  // ordinal stack — falling back to a plain top-to-bottom stack only when
  // the (post-merge) geometry wasn't decoded), when EVERY layer resolves
  // to a dataset + plotted channels (all-or-nothing). Falls through to the
  // clicked layer's own single-layer apply below, with a status note, when
  // any layer doesn't resolve.
  const family = figureLayerFamily(entry, get().originFigures);
  if (family.length >= 2) {
    const spatialResult = libs.resolveSpatialPanels(family, get().datasets);
    if (spatialResult) {
      const { panels: placed, layout, droppedOverlays } = spatialResult;
      get().setActive(entry.datasetId);
      // showAxisBox is the SINGLETON flag `useMultiPanelStage` reads for
      // every spatial panel (item 4) — Origin layers are boxed by default.
      set({
        stackMode: true,
        composition: spatialComposition(placed),
        facetKey: null, // F4.4 review L1 -- see the overlay branch's doc above
        // #54: a fresh tiled apply starts at the app-wide default fit
        // (Preferences ▸ Plot ▸ Multi-panel fit). The per-window value then
        // persists in `.dwk`.
        // A trusted overlapping/inset composition must begin in page mode;
        // the grid-oriented default would otherwise flatten its geometry.
        panelFit: layout === "page" ? "page" : get().defaultPanelFit,
        // #54 Stage 2: prefill the window's page from the figure's decoded
        // page size — aspect-honest (Origin page units aren't physical), null
        // when the page didn't decode. Enables the "page" fit + page export.
        pageSetup: pageSetupFromDecoded(family[0].figure.page ?? null),
        ...ORIGIN_FIGURE_AXIS,
        // Spatial bands live on each SpatialPanel; clear only the singleton
        // overlay list so a prior single plot cannot leak into this view.
        regionShades: [],
      });
      get().recordMacro(`Apply figure ${lit(fig.name)}`, `qz.applyFigure(${lit(id)})`);
      for (const msg of libs.spatialApplyNotices(layout, placed.length, droppedOverlays)) toast(msg, "info");
      return;
    }
    toast(
      "multi-panel layout: not every layer resolved a dataset — showing this layer only",
      "info",
    );
  }
  get().setActive(entry.datasetId);
  // Decoded curve bindings (partial recall, 100% precision) select the
  // actually-plotted channels; without them the default view stands.
  const ds = get().datasets.find((d) => d.id === entry.datasetId);
  const selection = ds ? libs.figureChannelSelection(fig, ds) : null;
  set({
    facetKey: null, // F4.4 review L1 -- see the overlay branch's doc above
    ...ORIGIN_FIGURE_AXIS,
    xLim: [fig.x_from, fig.x_to],
    yLim: [fig.y_from, fig.y_to],
    xStep: fig.x_step ?? null,
    yStep: fig.y_step ?? null,
    xScale: scaleFromLog(fig.x_log),
    yScale: scaleFromLog(fig.y_log),
    xAxisLabel: fig.x_title ?? "",
    yAxisLabel: fig.y_title ?? "",
    // Pin the figure's decoded floating text; REPLACE, never stack.
    annotations: libs.originFigureAnnotations([fig], entry.id),
    regionShades: libs.originRegionShades([fig], entry.id),
    ...libs.originLegendState(fig),
    ...libs.figureSelectionState(selection),
  });
  get().recordMacro(`Apply figure ${lit(fig.name)}`, `qz.applyFigure(${lit(id)})`);
}
