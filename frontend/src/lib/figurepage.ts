// Figure-page composer (GOTO #4) — pure slot model + helpers for composing N
// *different* plots onto ONE exported publication page (the "Figure 1(a)-(d)"
// workflow). The grid is a flat row-major slot array (index i -> row
// floor(i/cols), col i%cols); the backend route (/api/export/figure-page)
// owns the real layout + label rendering — these helpers keep the UI's slot
// state and preview labels consistent with it. Pure: no store imports (type-
// only imports of PlotWindow/FigureDoc for the session-liveness resolver
// below are fine — no store, no cycle).

import type { FigureDoc } from "./figuredoc";
import { docRenderable } from "./figuredoc";
import type { PlotWindow } from "./plotview";

export type PanelSourceKind = "window" | "figdoc";

/** Where a panel's plot comes from: an open plot window (live view + bound
 *  dataset) or a saved Library figure (FigureDoc). */
export interface PanelSource {
  kind: PanelSourceKind;
  id: string;
  name: string;
}

/** One grid slot: an assigned source (or empty) + optional per-panel
 *  overrides. `label === null` = auto "(a)", "(b)", … (backend placement
 *  order); `""` suppresses the label on this panel only. `title === null`
 *  keeps the source's own title. */
export interface PageSlot {
  source: PanelSource | null;
  label: string | null;
  title: string | null;
}

// Mirrors the backend's accepted values (calc/figure_page.py).
export const PAGE_LABEL_FORMATS = ["(a)", "a)", "a.", "(A)", "A)", "A.", "none"] as const;
export type PageLabelFormat = (typeof PAGE_LABEL_FORMATS)[number];
export const PAGE_LABEL_POSITIONS = ["nw", "ne", "outside"] as const;
export type PageLabelPosition = (typeof PAGE_LABEL_POSITIONS)[number];

/** UI grid bound (the backend itself caps at 8x8). */
export const PAGE_MAX_GRID = 4;

export function emptySlots(rows: number, cols: number): PageSlot[] {
  return Array.from({ length: rows * cols }, () => ({ source: null, label: null, title: null }));
}

/** Resize the grid, preserving each slot by its (row, col) position when it
 *  still fits (2x2 -> 3x2 keeps all four; shrinking drops slots that fall
 *  outside the new grid). */
export function resizeSlots(
  slots: PageSlot[],
  oldCols: number,
  rows: number,
  cols: number,
): PageSlot[] {
  const next = emptySlots(rows, cols);
  slots.forEach((slot, i) => {
    const r = Math.floor(i / oldCols);
    const c = i % oldCols;
    if (r < rows && c < cols) next[r * cols + c] = slot;
  });
  return next;
}

/** Assign a source to slot `i`. A source appears at most once on the page —
 *  assigning it somewhere else MOVES it (its previous slot empties, keeping
 *  that slot's label/title overrides for whatever lands there next). */
export function assignSlot(slots: PageSlot[], i: number, source: PanelSource): PageSlot[] {
  return slots.map((s, j) => {
    if (j === i) return { ...s, source };
    return s.source && s.source.kind === source.kind && s.source.id === source.id
      ? { ...s, source: null }
      : s;
  });
}

export function clearSlot(slots: PageSlot[], i: number): PageSlot[] {
  return slots.map((s, j) => (j === i ? { source: null, label: null, title: null } : s));
}

export function patchSlot(slots: PageSlot[], i: number, patch: Partial<PageSlot>): PageSlot[] {
  return slots.map((s, j) => (j === i ? { ...s, ...patch } : s));
}

/** Mirror of the backend auto-label generator (calc/figure_page.panel_label):
 *  0 -> "(a)", 1 -> "(b)", … with spreadsheet-style rollover (26 -> "(aa)"). */
export function panelLabel(index: number, fmt: PageLabelFormat): string {
  if (fmt === "none" || index < 0) return "";
  let letters = "";
  let n = index;
  for (;;) {
    letters = String.fromCharCode(97 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  const s = fmt === "(A)" || fmt === "A)" || fmt === "A." ? letters.toUpperCase() : letters;
  if (fmt === "(a)" || fmt === "(A)") return `(${s})`;
  if (fmt === "a)" || fmt === "A)") return `${s})`;
  return `${s}.`;
}

/** The label each slot previews: FILLED slots count through the auto sequence
 *  in slot (row-major) order — matching the backend's placement-order rule —
 *  with explicit per-slot overrides winning. Empty slots preview "". */
export function slotLabels(slots: PageSlot[], fmt: PageLabelFormat): string[] {
  let k = 0;
  return slots.map((s) => {
    if (!s.source) return "";
    const auto = panelLabel(k, fmt);
    k += 1;
    return s.label !== null ? s.label : auto;
  });
}

export function filledCount(slots: PageSlot[]): number {
  return slots.reduce((n, s) => n + (s.source ? 1 : 0), 0);
}

// ── live-session source resolution (FIGURE_AUTHORING_WORKFLOW_PLAN F3.2) ───
//
// The PERSISTED PageDocument model (lib/pageDocument.ts) resolves a panel's
// canonical `figureId` against `editableFigures` and fails closed to
// `{status:"missing"}` — never silently empty, never dropped. This session
// model has its own, older reference shape (`PanelSource`: an open window OR
// a legacy `figureDocs` entry, not yet unified with editableFigures — see
// useFigurePage.ts's `resolveSlotFigureId`), and needed the SAME fail-closed
// discipline: today a slot's cached `PanelSource` is displayed unconditionally
// once assigned, even after its window closes or its figdoc is deleted, so the
// grid kept showing a perfectly normal-looking tile for a dead reference until
// the whole page's preview/export failed with one generic message. This
// resolver is the fix's foundation: it re-checks LIVENESS on every render
// using the exact same rules `windowSources`/`docSources` already use to
// decide what is pickable in the first place (a window must still be a
// dataset-bound plot; a figdoc must still be `docRenderable`), so "can I
// assign it" and "is it still valid" can never drift apart.

export type PanelLifecycle = "live" | "frozen";

export type PanelSourceStatus =
  | { status: "empty" }
  | { status: "missing" }
  | { status: "ok"; lifecycle: PanelLifecycle };

/** Resolve one slot's assigned source against the CURRENT session state.
 *  `missing` covers both "the window/figdoc no longer exists" and "it exists
 *  but can no longer render" (dataset unbound/removed) — both leave the panel
 *  unable to produce a figure, and the caller (SlotGrid) treats them
 *  identically: label it, keep it selectable/clearable, never blank it. */
export function resolvePanelSource(
  source: PanelSource | null,
  plotWindows: readonly PlotWindow[],
  figureDocs: readonly FigureDoc[],
  datasetIds: ReadonlySet<string>,
): PanelSourceStatus {
  if (!source) return { status: "empty" };
  if (source.kind === "window") {
    const win = plotWindows.find((w) => w.id === source.id);
    if (!win || win.kind !== "plot" || win.datasetId === null) return { status: "missing" };
    const lifecycle: PanelLifecycle = win.document?.data.mode === "frozen" ? "frozen" : "live";
    return { status: "ok", lifecycle };
  }
  const doc = figureDocs.find((d) => d.id === source.id);
  if (!doc || !docRenderable(doc, datasetIds)) return { status: "missing" };
  return { status: "ok", lifecycle: doc.live ? "live" : "frozen" };
}
