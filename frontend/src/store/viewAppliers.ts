// The BULK VIEW APPLIERS, extracted from store/useApp.ts (audit P4.1 —
// "decompose high-risk frontend god-modules, characterization tests first";
// store-size ratchet, MAIN_PLAN #2). Composed into the ONE useApp store
// instance exactly like ./plotViewSettings and ./reportsFigureDocs — read
// store/windows.ts's header first: `useApp` spreads
// `createViewAppliersSlice(set, get)` into the store, so every existing
// `useApp((s) => ...)` selector and `useApp.getState().facetByColumn(...)`
// call keeps working. This file is a code boundary, not a second store.
//
// WHAT THIS MODULE OWNS: the three actions that install a WHOLE plot view in
// one gesture from a source description, rather than editing one setting at a
// time — `applyOriginFigure` (an imported Origin graph window, in its four
// branches: cross-book overlay, double-Y layer pair, spatial multi-panel
// family, and the single-layer fallback), `facetByColumn` (a small-multiples
// partition by a category column) and `breakAtGaps` (a paneled x-break
// arrangement). store/plotViewSettings.ts's header already named all three
// together as the bulk-appliers it deliberately does NOT own; this is where
// they went.
//
// WHAT IT DOES NOT OWN, deliberately:
//   - the FIELDS themselves. They stay declared (and initialized) on
//     `AppState` in store/useApp.ts, for the same reason plotViewSettings.ts
//     leaves them there: the per-setting writers, the dataset-switch resets
//     (`setActive`/`addDataset`/`duplicateDataset`) and the `.dwk` hydrate
//     (`loadWorkspace`) all write the same fields and are not part of this
//     cluster.
//   - the Origin-apply PREFLIGHTS. `confirmOriginReapplyDiscard` (the #57
//     discard confirm), `deferOriginFigureApply` (lazy source-book
//     resolution) and `deferOriginApplyLibs` (the lazy apply-chunk fetch)
//     stay in store/originFigureApply.ts, which is one of the three
//     grandfathered store modules allowed to import `components/`. Keeping
//     them there is what lets THIS module stay below the component layer.
//   - the decoded-figure interpretation itself: `lib/originFigures`,
//     `lib/originOverlay`, and the lazily-chunked
//     `lib/originFigureSelection` + `lib/originSpatialPanels` (reached only
//     through `originApplyLibs()`) own every byte-level and binding decision.
//     This module sequences them onto the store; it decides nothing about
//     what an Origin file means.
//
// WHAT IT MUST NOT IMPORT: nothing from `../components`, and no React — this
// is store-layer code (architecture.test.ts's "store/ layering guard" enforces
// it; the grandfathered set is three files and only shrinks). Only `lib/`
// pure helpers, sibling store modules, and the `AppState` TYPE from ./useApp
// (type-only, so the runtime import graph stays one-directional:
// useApp -> here).
//
// Characterization tests: store/viewAppliers.characterization.test.ts pins,
// per action AND per branch, the exact set of top-level store keys each call
// changes (a poisoned whole-getState() diff) plus the applied values, the undo
// label and the macro step. They were written and run GREEN against the
// pre-extraction code in useApp.ts, and pass byte-unchanged against this
// module.

import { compositionPanelCount, facetComposition, spatialComposition } from "../lib/composition";
import { breakCompositionFromData, facetPayloads, suggestBreaks } from "../lib/facet";
import { lit } from "../lib/macro";
import { figureLabel, figureLayerFamily } from "../lib/originFigures";
import { buildOverlayDataset, originOverlayDataset, overlayCurveLabels, overlayCurveStyles } from "../lib/originOverlay";
import { pageSetupFromDecoded } from "../lib/pagesetup";
import { dedupeWindowTitle, displayedWindowTitle, scaleFromLog } from "../lib/plotview";
import { analysisData } from "../lib/rowstate";
import { nextDatasetId } from "./idSeq";
import { originApplyLibs } from "./originApplyLibs"; // apply-only half: lazy chunk
import { confirmOriginReapplyDiscard, deferOriginApplyLibs, deferOriginFigureApply } from "./originFigureApply";
import { toast } from "./toasts";
import type { AppState } from "./useApp";

// Origin figures apply boxed + gridless (item 4; grid undecodable) — Origin's clean look, ticks still draw, user re-enables.
// Origin figures apply gridless + boxed + a clean read-only legend (decode
// #52); every apply branch spreads this, so `legendStatic` costs zero lines.
const ORIGIN_FIGURE_AXIS = { showAxisBox: true, showGrid: false, legendStatic: true };

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export interface ViewAppliersSlice {
  // Apply a stored figure after resolving lazy source books; unresolved = no-op.
  // `opts.newWindow` (item 9) opens a fresh window (bound to the figure's
  // dataset) and focuses it FIRST, so the rest of the apply logic — already
  // scoped to "the focused window" via `setActive`/the singleton `set()`
  // calls — lands on the new window instead of overwriting whatever was
  // focused before.
  applyOriginFigure: (id: string, opts?: { newWindow?: boolean; discardConfirmed?: boolean }) => void;
  // Facet-by-column (gap #21 residual): partitions `datasetId`'s analysis-view
  // rows into one small-multiples panel per distinct level of `col` (via
  // `lib/facet.facetPayloads`) and sets a facet `composition` for
  // MultiPanelStage to render. Activates `datasetId`, turns on `stackMode`,
  // and REPLACES any prior arrangement (the union makes that structural).
  // No-op (with a toast) when the dataset is missing or the column has no
  // finite levels to facet on.
  facetByColumn: (datasetId: string, col: number) => void;
  // Paneled x-breaks (gap #21 last residual): mirrors `facetByColumn`'s shape
  // but slices `datasetId`'s CURRENT x-column into contiguous segments (via
  // `lib/facet.breakPayloads`) instead of partitioning by a category column.
  // `breaks` is an explicit `[lo,hi]` override list; when omitted (or empty),
  // auto-detects via `lib/facet.suggestBreaks(xs, gapFactor)`. Activates
  // `datasetId`, turns on `stackMode`, and replaces any prior `composition`.
  // No-op (with a toast) when the dataset is missing, has no
  // rows in the analysis view, or no qualifying gap/override breaks exist.
  breakAtGaps: (datasetId: string, breaks?: [number, number][], gapFactor?: number) => void;
}

export function createViewAppliersSlice(set: SliceSet, get: SliceGet): ViewAppliersSlice {
  return {
    applyOriginFigure: (id, opts) => {
      const entry = get().originFigures.find((f) => f.id === id);
      if (!entry?.datasetId) return;
      if (confirmOriginReapplyDiscard(get, entry, id, opts) || deferOriginFigureApply(get, entry, id, opts)) return; // #57 confirm-then-defer
      // Bundle headroom slice 1: `libs` is the apply-only half of the figure
      // library, a LAZY chunk. Until it has been fetched, hand off to the third
      // preflight — it loads the chunk and re-enters here, taking this
      // synchronous path on the second pass (see store/originApplyLibs.ts).
      const libs = originApplyLibs();
      if (!libs) return deferOriginApplyLibs(get, id, opts);
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
    },
    // Facet-by-column (gap #21 residual): see `lib/composition.ts` for why a
    // facet panel is a different shape from a spatial one.
    // Reads the ANALYSIS view (guard #11 — exclusion #50 ∪
    // filter #53) so faceting honors whatever rows are currently in play, the
    // same contract `plotspec.specToRender`'s facet path already follows. The
    // current x/y channel selection carries over ONLY when `datasetId` is
    // already active (it's a per-dataset choice, meaningless applied to a
    // different dataset's column indices); otherwise `facetPayloads` falls
    // back to its own x=time / default-dense-channels choice, same as a fresh
    // `setActive` would.
    facetByColumn: (datasetId, col) => {
      const ds = get().datasets.find((d) => d.id === datasetId);
      if (!ds) return;
      const data = analysisData(ds);
      if (!data || data.time.length === 0) {
        toast("no rows to facet (all excluded or filtered out)", "danger");
        return;
      }
      const sameActive = get().activeId === datasetId;
      const panels = facetPayloads(
        data,
        col,
        sameActive ? get().xKey : null,
        sameActive ? get().yKeys : null,
      );
      if (panels.length === 0) {
        toast("that column has no finite levels to facet on", "danger");
        return;
      }
      // F4.4 (review K5): `facetKey` durably commits onto the focused window's
      // document (below) exactly like `setGroupKey` already does for
      // `groupKey` -- it needs the SAME ONE `recordHistory` call `setGroupKey`
      // makes, or Ctrl+Z after faceting silently reverts whatever edit came
      // BEFORE it instead (facetByColumn itself pushed nothing).
      const historyLenBefore = get().history.length;
      get().recordHistory("facet by column");
      get().setActive(datasetId);
      // L3 (review round 3): `setActive` USUALLY pushes no history of its own
      // (a plain "make this active" navigation) -- EXCEPT when the focused
      // window is pinned with no unpinned candidate to retarget to
      // (`retargetPassiveRebind`), where it creates a fresh window instead, and
      // `createWindow` pushes ITS OWN "create window" entry. Since nothing
      // mutates state between our push above and that one, the two entries are
      // near-duplicate snapshots of the SAME pre-gesture state -- Ctrl+Z would
      // pop "create window" (still correctly reverting the whole gesture, but
      // under the wrong label) and leave a same-state phantom entry sitting on
      // the stack, silently consuming a SECOND Ctrl+Z that the user expects to
      // reach whatever edit genuinely came before this one. Mechanism: drop
      // the later (createWindow's) duplicate, keeping our own — one gesture,
      // one entry, correctly labeled, in BOTH the pinned and unpinned paths.
      if (get().history.length > historyLenBefore + 1) {
        set((s) => ({ history: s.history.slice(0, -1) }));
      }
      // F4.4: `facetKey` is the DURABLE half of this gesture -- bindings-owned
      // like `groupKey`, it commits onto the focused window's document via the
      // SAME "focused facade -> document" sync every other PlotView field
      // already uses (`windowsForSave`/`focusWindow`'s outgoing snapshot), so
      // this facet survives save/reopen and stays rebuildable after a focus
      // switch even once `composition` itself (the immediate render cache) is
      // gone -- see `MultiPanelStage.tsx`'s `facetCompositionFromBinding` fallback.
      set({ stackMode: true, composition: facetComposition(panels), facetKey: col });
      get().recordMacro(
        `Facet by ${ds.data.labels[col] ?? `column ${col}`}`,
        `qz.facetByColumn(${lit(datasetId)}, ${col})`,
      );
    },
    // Paneled x-breaks (gap #21 last residual): see the state-field doc comment
    // for the sharing-axis contrast with `facetByColumn`. Reads the ANALYSIS
    // view (guard #11) so a break honors whatever rows are currently in play.
    // The x-column and y-selection carry over ONLY when `datasetId` is already
    // active (same rationale as `facetByColumn`); otherwise falls back to
    // `breakPayloads`' own x=time / default-dense-channels choice.
    breakAtGaps: (datasetId, breaks, gapFactor) => {
      const ds = get().datasets.find((d) => d.id === datasetId);
      if (!ds) return;
      const data = analysisData(ds);
      if (!data || data.time.length === 0) {
        toast("no rows to break (all excluded or filtered out)", "danger");
        return;
      }
      const sameActive = get().activeId === datasetId;
      const xKey = sameActive ? get().xKey : null;
      const yKeys = sameActive ? get().yKeys : null;
      const xs = xKey == null ? data.time : data.values.map((row) => row[xKey]);
      const useBreaks = breaks && breaks.length > 0 ? breaks : suggestBreaks(xs, gapFactor);
      if (useBreaks.length === 0) {
        toast("no large x-gaps found to break at", "danger");
        return;
      }
      const composition = breakCompositionFromData(data, useBreaks, xKey, yKeys);
      if (compositionPanelCount(composition) < 2) {
        toast("not enough data on both sides of a break to panel", "danger");
        return;
      }
      get().setActive(datasetId);
      // F4.4 review L1: clear the durable `facetKey` binding too -- a prior
      // `facetByColumn` on this SAME dataset leaves it set, and `setActive`
      // only resets it on a genuine dataset switch (`datasetViewDefaults`),
      // never when re-targeting the dataset that's already active. Without
      // this, a later focus round-trip resurrects the REPLACED facet grid
      // instead of this break arrangement (`useEffectiveComposition`'s
      // fallback reads facetKey whenever `composition` itself is null again).
      set({ stackMode: true, composition, facetKey: null });
      get().recordMacro(`Break x-axis at gaps`, `qz.breakAtGaps(${lit(datasetId)})`);
    },
  };
}
