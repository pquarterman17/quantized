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
// they went. Slice 18 (`plans/BUNDLE_HEADROOM.md`) moved the Origin apply's
// BODY, everything past its preflights, to store/originApplyRun.ts, which
// arrives with the lazy apply libraries; the action here keeps the
// preflights and runs that body synchronously once it has loaded.
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

import { compositionPanelCount, facetComposition } from "../lib/composition";
import { breakCompositionFromData, facetPayloads, suggestBreaks } from "../lib/facet";
import { lit } from "../lib/macro";
import type { OriginFigureEntry } from "../lib/originFigures";
import { analysisData } from "../lib/rowstate";
import { originApplyLibs } from "./originApplyLibs"; // apply-only half + body: lazy chunk
import { confirmOriginReapplyDiscard, deferOriginApplyLibs, deferOriginFigureApply } from "./originFigureApply";
import { toast } from "./toasts";
import { asOneEditStep } from "./undoStep";
import type { AppState } from "./useApp";

const ORIGIN_APPLY_LABEL = "apply Origin figure";

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
  // `datasetId`, turns on `stackMode`, and replaces any prior `composition`,
  // as ONE "break at gaps" undo step.
  // No-op (with a toast) when the dataset is missing, has no
  // rows in the analysis view, or no qualifying gap/override breaks exist.
  breakAtGaps: (datasetId: string, breaks?: [number, number][], gapFactor?: number) => void;
}

export function createViewAppliersSlice(set: SliceSet, get: SliceGet): ViewAppliersSlice {
  const slice: ViewAppliersSlice = {
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
      // Past every preflight: the body (store/originApplyRun.ts, bundle
      // headroom slice 18) came with `libs`, so it runs now, synchronously.
      // (`entry.datasetId` was checked non-null on this action's first line.)
      libs.runOriginFigureApply(set, get, ORIGIN_APPLY_LABEL, entry as OriginFigureEntry & { datasetId: string }, id, opts, libs);
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
      // ONE undo step, like `facetByColumn`: record before the rebind so the
      // entry snapshots the pre-break state, and fold `setActive`'s own
      // possible "create window" push (pinned focused window) into it.
      asOneEditStep(get, "break at gaps", () => {
        get().recordHistory("break at gaps");
        get().setActive(datasetId);
        // F4.4 review L1: clear the durable `facetKey` binding too -- a prior
        // `facetByColumn` on this SAME dataset leaves it set, and `setActive`
        // only resets it on a genuine dataset switch (`datasetViewDefaults`),
        // never when re-targeting the dataset that's already active. Without
        // this, a later focus round-trip resurrects the REPLACED facet grid
        // instead of this break arrangement (`useEffectiveComposition`'s
        // fallback reads facetKey whenever `composition` itself is null again).
        set({ stackMode: true, composition, facetKey: null });
      });
      get().recordMacro(`Break x-axis at gaps`, `qz.breakAtGaps(${lit(datasetId)})`);
    },
  };
  const applyOriginFigure = slice.applyOriginFigure;
  return { ...slice, applyOriginFigure: (id, opts) => asOneEditStep(get, ORIGIN_APPLY_LABEL, () => applyOriginFigure(id, opts)) };
}
