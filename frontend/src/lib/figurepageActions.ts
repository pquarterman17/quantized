// Figure-page composer (GOTO #4) — the ephemeral EDITING-SESSION slot model:
// pure grid helpers (assign/clear/patch/move/resize) + the live-session
// source resolver. Split out of `lib/figurepage.ts` (2026-08-23, C2 bundle
// pass — see `frontend/scripts/check-bundle-size.mjs`'s header for the
// ratchet this split feeds): `lib/figurepage.ts` keeps only the
// PAGE_LABEL_FORMATS/PAGE_LABEL_POSITIONS/PAGE_MAX_GRID constants + their
// tiny types, which `lib/pageDocument.ts`'s eager `sanitizeOutput` needs at
// the synchronous workspace-parse boundary; every function below is reached
// ONLY from the Figure Page workshop panel (SlotGrid, useFigurePage,
// usePageLifecycle, usePagePreviewExport, panelMenu, panelResolve) — already
// `lazy()`-gated behind Library.tsx, never the eager parse path — so
// co-locating ~190 lines of session-editing logic with those three constants
// was dragging the whole file (plus its `lib/figuredoc.ts`/`docRenderable`
// dependency) into the eager graph purely by file co-location (the same
// mechanism R8's `lib/api.ts`/primitives-barrel passes already fixed
// elsewhere). Verified before moving: none of the exports below has an eager
// consumer (real import grep, not text match) — every real (non-test)
// importer lives under components/workshops/figurepage/.

import type { FigureDocument } from "./figureDocument";
import type { FigureDoc } from "./figuredoc";
import { docRenderable } from "./figuredoc";
import type { PageLabelFormat } from "./figurepage";
import type { PlotWindow } from "./plotview";

export type PanelSourceKind = "window" | "figdoc" | "figure";

/** Where a panel's plot comes from: an open plot window (live view + bound
 *  dataset), a legacy Publication figure (FigureDoc), or — F3.3 — a saved
 *  canonical `editableFigures` entry picked directly (also how a reopened
 *  PageDocument's persisted `figureId` panels re-enter this session model:
 *  a saved page ONLY ever references a canonical id, so every one of its
 *  panels hydrates to a "figure" source, never "window"/"figdoc"). */
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

/** F3.5 manual rearrangement: swap the WHOLE slot record (source + label +
 *  title) at `i` and `j` as one unit — a panel's caption travels WITH it,
 *  not with the grid position it leaves behind. This is deliberately
 *  DIFFERENT from `assignSlot`'s "move" semantics (dragging a source-list
 *  item onto an already-occupied-elsewhere source only relocates the
 *  `source` field, leaving each slot's own label/title override behind):
 *  `assignSlot` is "put THIS source into this slot" (a fresh content pick,
 *  where the position's own caption is a legitimate thing to keep);
 *  `moveSlot` is "move this existing panel, caption included, to a new grid
 *  position" (the panel IS the source+caption together — nothing meaningful
 *  is left behind for the vacated slot to keep). No-op for an out-of-range
 *  or identical index pair. */
export function moveSlot(slots: PageSlot[], i: number, j: number): PageSlot[] {
  if (i === j || i < 0 || j < 0 || i >= slots.length || j >= slots.length) return slots;
  const next = slots.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export type GridDirection = "up" | "down" | "left" | "right";

/** The grid index adjacent to `index` in `direction` (row-major, `cols`-wide,
 *  `rows`-tall) — `null` when that would leave the grid. Shared by
 *  SlotGrid's Shift+Arrow rearrange handler (F3.5). */
export function gridNeighborIndex(
  index: number,
  cols: number,
  rows: number,
  direction: GridDirection,
): number | null {
  const r = Math.floor(index / cols);
  const c = index % cols;
  const [nr, nc] =
    direction === "up"
      ? [r - 1, c]
      : direction === "down"
        ? [r + 1, c]
        : direction === "left"
          ? [r, c - 1]
          : [r, c + 1];
  if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return null;
  return nr * cols + nc;
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
 *  `missing` covers both "the window/figdoc/figure no longer exists" and "it
 *  exists but can no longer render" (dataset unbound/removed, frozen snapshot
 *  missing) — both leave the panel unable to produce a figure, and the
 *  caller (SlotGrid) treats them identically: label it, keep it
 *  selectable/clearable, never blank it.
 *
 *  `editableFigures` defaults to `[]` so every pre-F3.3 call site (this
 *  session model predates the "figure" source kind) keeps compiling and
 *  behaving identically — none of them ever assign a "figure"-kind source,
 *  so an empty list can never wrongly report one as missing. */
export function resolvePanelSource(
  source: PanelSource | null,
  plotWindows: readonly PlotWindow[],
  figureDocs: readonly FigureDoc[],
  datasetIds: ReadonlySet<string>,
  editableFigures: readonly FigureDocument[] = [],
): PanelSourceStatus {
  if (!source) return { status: "empty" };
  if (source.kind === "window") {
    const win = plotWindows.find((w) => w.id === source.id);
    if (!win || win.kind !== "plot" || win.datasetId === null) return { status: "missing" };
    const lifecycle: PanelLifecycle = win.document?.data.mode === "frozen" ? "frozen" : "live";
    return { status: "ok", lifecycle };
  }
  if (source.kind === "figure") {
    const document = editableFigures.find((f) => f.id === source.id);
    if (!document) return { status: "missing" };
    if (document.data.mode === "live") {
      if (!document.bindings.datasetId || !datasetIds.has(document.bindings.datasetId)) {
        return { status: "missing" };
      }
      return { status: "ok", lifecycle: "live" };
    }
    return document.data.snapshot ? { status: "ok", lifecycle: "frozen" } : { status: "missing" };
  }
  const doc = figureDocs.find((d) => d.id === source.id);
  if (!doc || !docRenderable(doc, datasetIds)) return { status: "missing" };
  return { status: "ok", lifecycle: doc.live ? "live" : "frozen" };
}
