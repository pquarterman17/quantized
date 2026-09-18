// Canonical FigureDocument bridge for MDI plot windows. Kept out of the
// pinned windows/useApp slices so document migration does not regrow them.
import {
  createFigureDocument,
  figureDocumentToPlotView,
  updateFigureDocumentFromPlotView,
  type FigureDocument,
} from "../lib/figureDocument";
import { errKeysFromBindings, type ErrorBinding } from "../lib/errorRoles";
import type { PlotView, PlotWindow } from "../lib/plotview";
import type { Dataset } from "../lib/types";

const figureIdForWindow = (windowId: string): string => `figure-${windowId}`;

export function plotWindowView(window: PlotWindow): PlotView {
  return window.kind === "plot" && window.document
    ? figureDocumentToPlotView(window.document)
    : window.view;
}

export function plotWindowDatasetId(window: PlotWindow): string | null {
  return window.kind === "plot" && window.document
    ? window.document.bindings.datasetId
    : window.datasetId;
}

export interface CreatePlotWindowDocumentOptions {
  previous?: FigureDocument;
  /** Mint a window-derived id even when `previous` is given — the DUPLICATE
   *  path. Without it a duplicated window shares the source's document
   *  identity, so Save on the duplicate would overwrite the original saved
   *  figure and the open-figure lookup becomes ambiguous. */
  freshIdentity?: boolean;
  /** `undefined` inherits the previous document's bindings; `null` derives
   *  fresh bindings from the view's own errKeys instead — the reset path.
   *  Without the sentinel, a resetErrors sync with no explicit list would
   *  resurrect the previous document's bindings, whose channel indices are
   *  exactly what a reimport shape change just invalidated (the row/column
   *  index-staleness class of 2026-07-19/21). */
  errors?: readonly NonNullable<Dataset["errorRoles"]>[number][] | null;
  /** BUG-012 review F4: drop `previous`'s `plot.axisBreaks` instead of
   *  inheriting it — the GENUINE-DATASET-SWITCH path, where `view.facetKey`
   *  already arrives nulled by `store/windowDefaults.ts`'s
   *  `datasetViewDefaults` for the very reason its own comment gives (a
   *  binding built against the OLD dataset's columns is meaningless applied
   *  to a new one). An x-break is that same class of stale binding: it is
   *  expressed in the OLD dataset's x units, and since BUG-012 the SCREEN
   *  reads it too (`lib/facet.ts`'s `durableComposition`), so without this a
   *  plain Library click onto an unrelated dataset with an overlapping x
   *  range panelled the NEW dataset at the OLD one's gap, with no gesture and
   *  no toggle. The export path had always carried the stale value; the
   *  visible symptom was new. Deliberately NOT applied to a re-activation of
   *  the already-active dataset (`setActive`'s own `s.activeId !== id` test),
   *  nor to a same-dataset reimport or error resync — neither is a dataset
   *  switch. An explicit DROP onto a BACKGROUND window is the one deliberate
   *  exception: that branch re-applies `datasetViewDefaults` wholesale, and
   *  `facetKey` — the one channel-keyed binding `store/windows.ts`'s
   *  per-technique view memory (`lib/techniqueViewMemory.ts`) deliberately
   *  does NOT carry — resets even when the same dataset is dropped back on.
   *  An x-break is that same class of channel-keyed binding, so it resets
   *  with `facetKey` (round 3, finding 7; pinned by `store/useApp.test.ts`).
   *  `xKey`/`yKeys` are a DIFFERENT case: a technique-tagged dataset's
   *  memory does carry them, so they can come back restored on a
   *  same-dataset re-drop rather than resetting (round-3 review NIT 1). */
  resetAxisBreaks?: boolean;
}

export function createPlotWindowDocument(
  windowId: string,
  name: string,
  datasetId: string | null,
  view: PlotView,
  options: CreatePlotWindowDocumentOptions = {},
): FigureDocument {
  const previous = options.previous;
  return createFigureDocument({
    id: options.freshIdentity ? figureIdForWindow(windowId) : (previous?.id ?? figureIdForWindow(windowId)),
    name,
    datasetId,
    view,
    mark: previous?.plot.mark,
    // F4.4 review K2/K3: sourced from `view`, NOT `previous?.bindings.*` --
    // `view` is always a complete, caller-intended `PlotView` (bindings-
    // owned fields included), so it already carries whatever the caller
    // wants here: a genuine reset's freshly-computed null (a dataset
    // rebind's `datasetViewDefaults`, or a shape-changed reimport's
    // `viewReset` -- both already null this out), a duplicate's live
    // snapshot (an uncommitted `facetByColumn` mid-focus, K3), or -- for a
    // background window's `plotWindowView(w)` projection, which always
    // mirrors `document.bindings.*` exactly (`figureDocumentToPlotView`'s
    // own projection) -- the SAME value `previous?.bindings.*` would have
    // given anyway. `previous?.bindings.*` silently ignored `view` here and
    // re-inherited the OLD document's possibly-stale value instead: a
    // shape-changed reimport's `syncPlotWindow` reset branch computed the
    // correct `view.facetKey: null` and then threw it away, so the stale
    // column index rode straight into the rebuilt document and out to
    // `.dwk` (K2); `duplicateWindow`'s focused-source path passed the LIVE
    // `view` but the not-yet-committed `previous.bindings.facetKey` was
    // still null, so a freshly-faceted window duplicated as unfaceted (K3).
    groupKey: view.groupKey,
    facetKey: view.facetKey,
    errors: options.errors === null ? undefined : (options.errors ?? previous?.bindings.errors),
    data: previous?.data,
    axisBreaks: options.resetAxisBreaks ? undefined : previous?.plot.axisBreaks,
    output: previous?.output,
    publication: previous?.publication,
  });
}

interface SyncPlotWindowOptions {
  title?: string;
  datasetId?: string | null;
  errors?: readonly NonNullable<Dataset["errorRoles"]>[number][];
  resetErrors?: boolean;
  /** Forwarded to `createPlotWindowDocument` — see its own doc. Only the
   *  three genuine-dataset-switch rebind sites pass it: `focusedRebindPatch`
   *  and `rebindWindow`'s background branch (`store/windows.ts`), and
   *  `rebindFocusedPlotWindow` below (the import leg). */
  resetAxisBreaks?: boolean;
}

/** Keep compatibility projections aligned while the document is authoritative at rest. */
export function syncPlotWindow(
  window: PlotWindow,
  view: PlotView,
  options: SyncPlotWindowOptions = {},
): PlotWindow {
  if (window.kind !== "plot") return { ...window, view };
  const title = options.title ?? window.title;
  const datasetId = options.datasetId === undefined ? window.datasetId : options.datasetId;
  const document = window.document && !options.resetErrors && options.errors === undefined
    ? updateFigureDocumentFromPlotView(window.document, { view, name: title, datasetId })
    : createPlotWindowDocument(window.id, title, datasetId, view, {
        previous: window.document,
        errors: options.resetErrors ? (options.errors ?? null) : (options.errors ?? window.document?.bindings.errors),
        resetAxisBreaks: options.resetAxisBreaks,
      });
  return {
    ...window,
    title: document.name,
    datasetId: document.bindings.datasetId,
    view: figureDocumentToPlotView(document),
    document,
  };
}

/** Replace a plot window's canonical document and regenerate every legacy
 * projection from it. Figure lifecycle actions must use this rather than
 * assigning `window.document` beside a hand-maintained title/view/datasetId
 * triple; that was exactly the desynchronization class found in the F1 review.
 */
export function withPlotWindowDocument(window: PlotWindow, document: FigureDocument): PlotWindow {
  if (window.kind !== "plot") return window;
  const canonical = structuredClone(document);
  return {
    ...window,
    title: canonical.name,
    datasetId: canonical.bindings.datasetId,
    view: figureDocumentToPlotView(canonical),
    document: canonical,
  };
}

/** Drop the FOCUSED plot window's saved x-axis breaks, through the declared
 *  document-write chokepoint (`withPlotWindowDocument`).
 *
 *  BUG-012 review F3. `setStackMode` clears the live `composition` AND the
 *  durable `facetKey`, so switching stacking off returns a facet grid to a
 *  plain XY plot. Since BUG-012 the screen ALSO rebuilds a paneled
 *  arrangement from `document.plot.axisBreaks.x` whenever the live
 *  composition is null (`lib/facet.ts`'s `durableComposition`), and that
 *  fallback is deliberately independent of `stackMode` — an authored break
 *  has no toggle to restore (`Stage/useEffectiveComposition.ts`'s
 *  `multiPanelShowing`). The two together made the toggle INERT for a
 *  broken-axis figure: the panels came straight back on the next render,
 *  silently. Clearing the break here restores the toggle's meaning and keeps
 *  it symmetric with the `facetKey` cleared on the same line.
 *
 *  BOTH directions of the toggle clear it, exactly as `facetKey` does, and
 *  round 3 makes that explicit rather than incidental: a break arrangement
 *  and the per-channel stack are mutually exclusive compositions of the same
 *  canvas, and the break WINS (`multiPanelShowing` short-circuits on
 *  `breakPanelsOf(composition) !== null`, ahead of every `stackMode` clause).
 *  Leaving the break in place on `setStackMode(true)` would therefore make
 *  the ON direction inert in precisely the way F3 fixed for OFF — the user
 *  presses Stack and still gets the break panels. It is also what the
 *  toggle's own comment in `useApp.setStackMode` already promised for every
 *  other arrangement: "a manual toggle (on OR off) always drops any spatial
 *  arrangement … the plain per-channel split (or leaving stack mode) is what
 *  the user asked for". Undo restores it (`plotWindows` is in the history
 *  snapshot and `setStackMode` records history first).
 *
 *  This is a user action deleting a field, not a persistence change: the
 *  `.dwk` contract for `plot.axisBreaks` is untouched, and the Figure
 *  Builder's breaks panel remains the affordance that authors one. A no-op
 *  for a window that is not focused, carries no document, or holds no
 *  breaks — the SAME ARRAY comes back, not just the same window object, so
 *  no `plotWindows` subscriber re-renders and `useWorkspaceAutosave`'s
 *  identity-compared `shouldAutosave` does not mark the project dirty
 *  (round 3, finding 3: `Array.prototype.map` always allocates, so every
 *  stack toggle in a workspace with no break anywhere flipped the ● marker
 *  and restarted the 800 ms autosave debounce). */
export function clearFocusedXBreaks(
  windows: readonly PlotWindow[],
  focusedId: string | null,
): PlotWindow[] {
  let changed = false;
  const next = windows.map((window) => {
    if (window.id !== focusedId || window.kind !== "plot" || !window.document) return window;
    const breaks = window.document.plot.axisBreaks;
    if (breaks.x.length === 0) return window;
    changed = true;
    return withPlotWindowDocument(window, {
      ...window.document,
      plot: { ...window.document.plot, axisBreaks: { ...breaks, x: [] } },
    });
  });
  return changed ? next : (windows as PlotWindow[]);
}

/** Item 3: overwrite ONE window's document error bindings, leaving every
 *  other field untouched -- openFigureDocInWindow's fix for a FigureDoc's own
 *  error-well config (Graph Builder's Y/X error wells), which `createWindow`
 *  cannot see (it only seeds `bindings.errors` from the bound dataset's
 *  already-committed `errorRoles`, not from the doc being opened). Returns
 *  both the patched window list and the legacy `errKeys` projection the
 *  focused-window facade must be kept in sync with: `liveWindowDocument` ->
 *  `updateFigureDocumentFromPlotView` reconstructs a focused window's
 *  document on every subsequent commit from `richErrors` (X-axis/asymmetric
 *  bindings, read off `document.bindings.errors`) PLUS
 *  `legacyErrorBindings(view.errKeys)` (symmetric Y) -- so a symmetric-Y
 *  binding applied to the document alone, with the top-level `errKeys`
 *  singleton left stale, would vanish again on the very next commit. */
export function withWindowDocumentErrors(
  windows: readonly PlotWindow[],
  windowId: string,
  errors: readonly ErrorBinding[],
): { plotWindows: PlotWindow[]; errKeys: Record<number, number> } {
  return {
    plotWindows: windows.map((window) =>
      window.id === windowId && window.kind === "plot" && window.document
        ? withPlotWindowDocument(window, {
            ...window.document,
            bindings: { ...window.document.bindings, errors: [...errors] },
          })
        : window,
    ),
    errKeys: errKeysFromBindings(errors),
  };
}

export function commitFocusedPlotWindow(
  windows: readonly PlotWindow[],
  focusedId: string | null,
  view: PlotView,
): PlotWindow[] {
  return windows.map((window) => window.id === focusedId ? syncPlotWindow(window, view) : window);
}

/** The IMPORT leg of the same genuine-dataset-switch rebind `setActive` does
 *  (`store/useApp.ts`'s `addDataset` is its only caller, and import, paste,
 *  demo, merge and append all route through that). `resetAxisBreaks` is
 *  UNCONDITIONAL here: the dataset being bound was constructed moments ago
 *  and is not yet in the store, so it can never be the one the window is
 *  already on — the single case `setActive` exempts. Without it, a window
 *  holding an authored `[[2, 3]]` panelled the freshly imported dataset at
 *  the PREVIOUS one's gap, with no gesture and no toggle (round 3, finding 1:
 *  F4 covered `setActive` and `rebindWindow` but missed this, the most common
 *  way a new dataset reaches the focused window). */
export function rebindFocusedPlotWindow(
  windows: readonly PlotWindow[],
  focusedId: string | null,
  view: PlotView,
  dataset: Dataset,
): PlotWindow[] {
  return windows.map((window) =>
    window.id === focusedId
      ? syncPlotWindow(window, view, {
          datasetId: dataset.id,
          errors: dataset.errorRoles,
          resetErrors: true,
          resetAxisBreaks: true,
        })
      : window,
  );
}

export function syncDatasetWindowDocuments(
  windows: readonly PlotWindow[],
  datasetId: string,
  errors?: readonly NonNullable<Dataset["errorRoles"]>[number][],
): PlotWindow[] {
  return windows.map((window) =>
    window.datasetId === datasetId
      ? syncPlotWindow(window, window.view, { errors, resetErrors: true })
      : window,
  );
}

/** Remove deleted dataset bindings from both projections of every live plot
 * window. This belongs with the document-write chokepoint, rather than in the
 * pure PlotWindow model, so a future binding change cannot update only one.
 */
export function pruneWindowDatasetRefs(
  windows: readonly PlotWindow[],
  removed: ReadonlySet<string>,
): PlotWindow[] {
  return windows.map((window) => {
    // A canonical document wins over a stale compatibility projection. Fold
    // the removal into it first, then regenerate title/dataset/view together.
    // This also repairs a transitional window whose two dataset ids disagree.
    if (window.kind === "plot" && window.document) {
      const documentDatasetRemoved =
        window.document.bindings.datasetId !== null && removed.has(window.document.bindings.datasetId);
      const facadeDatasetRemoved = window.datasetId !== null && removed.has(window.datasetId);
      if (!documentDatasetRemoved && !facadeDatasetRemoved) return window;
      const document = documentDatasetRemoved
        ? { ...window.document, bindings: { ...window.document.bindings, datasetId: null } }
        : window.document;
      return withPlotWindowDocument(window, document);
    }
    const datasetRemoved = window.datasetId !== null && removed.has(window.datasetId);
    const panelDatasetIds = window.panel?.datasetIds;
    const panelChanged = panelDatasetIds?.some((id) => removed.has(id)) ?? false;
    if (!datasetRemoved && !panelChanged) return window;

    const datasetId = datasetRemoved ? null : window.datasetId;
    const panel = panelChanged && window.panel
      ? { ...window.panel, datasetIds: window.panel.datasetIds.filter((id) => !removed.has(id)) }
      : window.panel;
    return { ...window, datasetId, ...(panel ? { panel } : {}) };
  });
}
