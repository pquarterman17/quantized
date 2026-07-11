// The multi-dataset panel/overlay composite window's pure model (MAIN_PLAN
// #19 v1): grid-shape math for the row/column/grid layouts (reusing
// `multipanel.facetGridSize`'s sqrt-balanced tiling for "grid"), the
// union-x + null-fill payload builder for the "overlay" layout, and the
// unit-family -> dual-Y axis assignment the owner decided
// (same units share the left axis; the 2nd distinct unit family gets the
// right/y2 axis; a 3rd+ family collapses back onto the left with a caller-
// side warning). No React/store/uPlot-instance imports — this stays a leaf
// lib module so `lib/plotview.ts` (the window-record model) can depend on it
// for the "panel" WindowKind's extra fields without a cycle.
//
// Row-state (#50/#53): `buildOverlayPayload` reads each dataset through
// `lib/rowstate.analysisData` (the sanctioned chokepoint — see
// `architecture.test.ts`'s row-state guard), so manual exclusion and the
// local filter are honored in the merged overlay exactly like every other
// analysis view. The row/column/grid layouts don't need this file at all —
// each panel is its own `usePlotPayload` call (see `components/windows/
// PanelCell.tsx`), which already reads rowstate the same way every other
// single-dataset plot window does.

import type uPlot from "uplot";

import { defaultDenseChannels, type PlotPayload, type PlotSeriesSpec } from "./plotdata";
import { facetGridSize } from "./multipanel";
import { analysisData } from "./rowstate";
import type { Dataset } from "./types";

/** The four v1 quick-pick layouts (MAIN_PLAN #19): "row"/"column" force a
 *  single line of panels; "grid" auto-shapes near-square; "overlay" merges
 *  every dataset onto ONE shared axes instead of separate panels. */
export type PanelLayout = "row" | "column" | "grid" | "overlay";

export const PANEL_LAYOUTS: readonly PanelLayout[] = ["row", "column", "grid", "overlay"];

/** Grid dimensions for `n` panels under `layout` — "row"/"column" always
 *  force a single line (1×n / n×1); "grid" delegates to the same
 *  sqrt-balanced tiling the facet-panel mode uses (`multipanel.
 *  facetGridSize`) so a panel window's grid looks like every other
 *  small-multiples grid in the app. "overlay" never calls this (a single
 *  viewport has no grid) — included in the union only so callers can pass
 *  a `PanelLayout` without a runtime guard; returns 1x1. Matches
 *  `facetGridSize`'s empty-set fallback for n<=0. */
export function panelGridShape(layout: PanelLayout, n: number): { rows: number; cols: number } {
  if (n <= 0) return { rows: 1, cols: 1 };
  if (layout === "row") return { rows: 1, cols: n };
  if (layout === "column") return { rows: n, cols: 1 };
  if (layout === "overlay") return { rows: 1, cols: 1 };
  return facetGridSize(n);
}

/** A new composite window's default title: "Panel: A, B, C" / "Overlay: A,
 *  B, C" (item 10's dedupe wrapper handles collisions across windows, same
 *  as every other computed default). Falls back to a bare prefix when every
 *  selected id's dataset already vanished before the window was created (a
 *  vanishingly rare race — the Library quick pick reads live names). */
export function panelWindowTitle(layout: PanelLayout, names: readonly string[]): string {
  const prefix = layout === "overlay" ? "Overlay" : "Panel";
  return names.length > 0 ? `${prefix}: ${names.join(", ")}` : prefix;
}

/** The private cross-panel sync-group key for composite window `windowId`
 *  (MAIN_PLAN #19 v1: "panels within one composite window join a private
 *  sync group... so x-zoom/cursor link across panels by default") — reuses
 *  `lib/windowsync`'s existing group registry/hook, just keyed per-window
 *  instead of per cross-window link group. */
export function panelSyncKey(windowId: string): string {
  return `qz-panel-${windowId}`;
}

/** Validate a persisted panel window's `datasetIds` (.dwk / untrusted
 *  boundary — same discipline as `plotview.sanitizePlotWindows`): drop
 *  anything that isn't a string, or doesn't name a LIVE dataset. Order is
 *  preserved; a stale id is simply dropped (item 19's "a removed dataset
 *  drops out of the panel" — the SAME rule applies whether the dataset was
 *  removed before or after the last save). */
export function sanitizePanelDatasetIds(v: unknown, dsIds: ReadonlySet<string>): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((id): id is string => typeof id === "string" && dsIds.has(id));
}

/** Validate a persisted panel window's `layout`; malformed/missing falls
 *  back to "grid" (the safest default — never assumes "overlay", which
 *  changes the payload shape, not just the arrangement). */
export function sanitizePanelLayout(v: unknown): PanelLayout {
  return (PANEL_LAYOUTS as readonly string[]).includes(v as string) ? (v as PanelLayout) : "grid";
}

// ── Drag-to-rearrange cells within a composite window (MAIN_PLAN #19
// drag-follow-up) ────────────────────────────────────────────────────────
// The grab surface is each PanelCell's header row (window furniture, like an
// MDI title bar — NOT the uPlot canvas, which keeps its normal box-zoom/pan
// in every tool mode). Same dataTransfer-payload idiom as `dragaxis.
// encodeChannelDrag`/`decodeChannelDrag` and `useLibraryTree.DATASET_DND`:
// a JSON payload behind its own MIME type so a drop target can tell this
// drag apart from a channel-chip drag, a Library row drag, or an OS file
// drop via `dataTransfer.types`.

/** dataTransfer MIME type for an internal panel-cell reorder drag. Distinct
 *  from `CHANNEL_DND` (dragaxis.ts), `DATASET_DND` (useLibraryTree.ts), and
 *  `PANEL_SOURCE_MIME` (figurepage/SlotGrid.tsx). */
export const PANEL_CELL_DND = "application/x-qz-panel-cell";

/** What's dragged: one cell of one composite panel window, identified by its
 *  POSITION in `panel.datasetIds` (a cell's identity for reordering purposes
 *  IS its slot, not the dataset id — two cells never share a dataset).
 *  `windowId` guards a drag that somehow survives into a DIFFERENT panel
 *  window (e.g. two composite windows open at once) from being misapplied
 *  there. */
export interface PanelCellDragPayload {
  windowId: string;
  fromIndex: number;
}

/** JSON-encode a payload onto dataTransfer (structured data needs a MIME
 *  string, not an object — same idiom as `dragaxis.encodeChannelDrag`). */
export function encodePanelCellDrag(payload: PanelCellDragPayload): string {
  return JSON.stringify(payload);
}

/** Parses a panel-cell drag payload; null for anything malformed (a stale/
 *  foreign string, corrupted JSON, an OS file drop, …) so callers can safely
 *  ignore it rather than throw mid-drop. */
export function decodePanelCellDrag(raw: string): PanelCellDragPayload | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (
      v !== null &&
      typeof v === "object" &&
      typeof (v as Record<string, unknown>).windowId === "string" &&
      typeof (v as Record<string, unknown>).fromIndex === "number" &&
      Number.isInteger((v as Record<string, unknown>).fromIndex)
    ) {
      return v as PanelCellDragPayload;
    }
  } catch {
    // not our payload — fall through to null
  }
  return null;
}

/** Reorder-insert splice: moves the id at `fromIndex` to sit at `toIndex`'s
 *  slot, shifting the ids between the two over by one — dropping cell A on
 *  cell B splices A INTO B's position (B and everything between shift
 *  toward A's old slot), it never swaps the pair. Self-drop
 *  (`fromIndex === toIndex`) and any out-of-range index are no-ops (return a
 *  same-order copy rather than throwing or silently clamping into a
 *  different move). */
export function reorderPanelDatasetIds(
  ids: readonly string[],
  fromIndex: number,
  toIndex: number,
): string[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    fromIndex >= ids.length ||
    toIndex < 0 ||
    toIndex >= ids.length
  ) {
    return [...ids];
  }
  const next = [...ids];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/** Drops one dataset id out of a panel's list (the header ✕ chip bonus) — a
 *  plain filter; no "last one" special case, since the render layer already
 *  tolerates a panel shrinking to 1 or 0 cells (PanelPlotWindow's empty-state
 *  placeholder / single-cell case, same tolerance dataset-removal pruning
 *  relies on). A missing id is a no-op. */
export function removePanelDatasetId(ids: readonly string[], id: string): string[] {
  return ids.filter((x) => x !== id);
}

/** First-appearance-order unit families across every series about to be
 *  plotted, plus whether a 3rd+ family had to double up on the left axis —
 *  the owner-decided dual-Y rule (MAIN_PLAN #19): same units share the left
 *  axis; the 2nd distinct family gets the right (y2) axis; a 3rd+ family
 *  collapses back onto the left with `overflow=true` so the caller can toast
 *  a warning exactly once. Unit strings compare by exact equality (including
 *  "" for a dimensionless channel, which is its own family like any other). */
export interface UnitFamilies {
  /** Unit strings in first-seen order; index = family number (0-based). */
  families: string[];
  /** True when a 3rd+ family exists (so families[2+] all share the left axis). */
  overflow: boolean;
}

export function assignUnitFamilies(units: readonly string[]): UnitFamilies {
  const families: string[] = [];
  for (const u of units) if (!families.includes(u)) families.push(u);
  return { families, overflow: families.length > 2 };
}

/** The axis (0 = left/primary, 1 = right/y2) for `unit` given its family's
 *  first-seen order in `families` — family 0 -> left, family 1 -> right,
 *  family 2+ -> left again (see `assignUnitFamilies`'s doc for the rule). */
export function axisForUnit(families: readonly string[], unit: string): 0 | 1 {
  return families.indexOf(unit) === 1 ? 1 : 0;
}

export interface OverlayPayloadResult {
  payload: PlotPayload;
  families: string[];
  overflow: boolean;
}

/** Merge N datasets into ONE union-x overlay payload (the "Overlay in one
 *  plot" quick pick): each dataset's own default-dense channels (its own
 *  `.time` as x — the panel builder has no per-dataset x-channel picker in
 *  v1), pruned through `lib/rowstate.analysisData` so manual exclusion
 *  (#50) and the local filter (#53) are honored exactly like every other
 *  analysis view, become series on a SHARED, sorted, deduplicated union of
 *  every dataset's finite x values. A dataset's series read null at every
 *  union x-point its OWN grid doesn't cover — an outer join, never an
 *  interpolation. Non-destructive: builds a fresh payload every call, never
 *  a new Dataset (no store write happens here). Series are labeled
 *  "<dataset name>: <channel label>" (item 19's "legend entries prefixed
 *  with the dataset name"); axis assignment follows `assignUnitFamilies`/
 *  `axisForUnit`. Empty input returns an empty (x-only) payload. */
export function buildOverlayPayload(datasets: readonly Dataset[]): OverlayPayloadResult {
  const perDs = datasets.map((ds) => {
    const data = analysisData(ds) ?? ds.data;
    return { ds, data, channels: defaultDenseChannels(data, null) };
  });

  const xSet = new Set<number>();
  for (const { data } of perDs) {
    for (const t of data.time) if (Number.isFinite(t)) xSet.add(t);
  }
  const unionX = [...xSet].sort((a, b) => a - b);
  const rowAt = perDs.map(({ data }) => {
    const m = new Map<number, number>();
    data.time.forEach((t, r) => {
      if (Number.isFinite(t) && !m.has(t)) m.set(t, r); // first row wins on a duplicate x
    });
    return m;
  });

  const units: string[] = [];
  for (const { data, channels } of perDs) for (const c of channels) units.push(data.units[c] ?? "");
  const { families, overflow } = assignUnitFamilies(units);

  const series: PlotSeriesSpec[] = [];
  const cols: (number | null)[][] = [unionX];
  perDs.forEach(({ ds, data, channels }, di) => {
    for (const c of channels) {
      const unit = data.units[c] ?? "";
      cols.push(
        unionX.map((x) => {
          const r = rowAt[di].get(x);
          if (r == null) return null;
          const v = data.values[r][c];
          return Number.isFinite(v) ? v : null;
        }),
      );
      series.push({
        label: `${ds.name}: ${data.labels[c] ?? `ch${c}`}`,
        unit,
        axis: axisForUnit(families, unit),
      });
    }
  });

  const first = perDs[0]?.data;
  return {
    payload: {
      data: cols as unknown as uPlot.AlignedData,
      series,
      xLabel: String(first?.metadata?.["x_column_long"] || first?.metadata?.["x_column_name"] || "x"),
      xUnit: String(first?.metadata?.["x_column_unit"] ?? ""),
    },
    families,
    overflow,
  };
}
