// The composite panel window's RECORD model — the part of
// lib/panelwindow.ts the always-loaded window model needs: the layout union,
// the default title, the .dwk sanitizers (lib/plotview.ts's
// `sanitizePlotWindows`) and the cell reorder/remove list edits
// (store/panels.ts). Split out verbatim (bundle headroom slice 13,
// plans/BUNDLE_HEADROOM.md, the slice-12 "small eager half" shape) so the
// render-only rest of lib/panelwindow.ts — grid shape, sync key, the cell
// drag codec, unit families and the overlay payload builder, all used only
// by the lazy PanelPlotWindow tree — stays out of the entry chunk.
// lib/panelwindow.ts re-exports everything here, so its importers are
// unchanged; an eager module must import from THIS file, not that one
// (architecture.test.ts's DRAGGED_OUT list is the guard).

/** The four v1 quick-pick layouts (MAIN_PLAN #19): "row"/"column" force a
 *  single line of panels; "grid" auto-shapes near-square; "overlay" merges
 *  every dataset onto ONE shared axes instead of separate panels. */
export type PanelLayout = "row" | "column" | "grid" | "overlay";

export const PANEL_LAYOUTS: readonly PanelLayout[] = ["row", "column", "grid", "overlay"];

/** A new composite window's default title: "Panel: A, B, C" / "Overlay: A,
 *  B, C" (item 10's dedupe wrapper handles collisions across windows, same
 *  as every other computed default). Falls back to a bare prefix when every
 *  selected id's dataset already vanished before the window was created (a
 *  vanishingly rare race — the Library quick pick reads live names). */
export function panelWindowTitle(layout: PanelLayout, names: readonly string[]): string {
  const prefix = layout === "overlay" ? "Overlay" : "Panel";
  return names.length > 0 ? `${prefix}: ${names.join(", ")}` : prefix;
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
