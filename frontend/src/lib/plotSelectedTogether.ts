// PLOT_WORKFLOW_PLAN #3 "Plot selected together" — the shared action behind
// the command palette entry, the Plot menu item, and the Library selection
// context-menu entry (three surfaces, one implementation, same shape as the
// panel-layout quick picks in commands/plotCommands.ts and
// lib/contextActions.ts's datasetMultiSelectActions). Resolves the current
// multi-selection, filters out 2-D maps (a map has no single curve to
// contribute — see lib/mapdata.is2DMap), builds the merged overlay via
// lib/originOverlay.buildSelectionOverlay, and lands it as a new Library
// dataset the SAME way applyOriginFigure's cross-book overlay does
// (store/useApp.ts's addDataset already activates it, retargets the focused
// window, and resets the view — see that function's own doc).
//
// Lives outside store/useApp.ts deliberately: that store sits AT its
// architecture.test.ts size-ratchet pin with zero headroom (see the pin's
// history comment), and this command needs no new persistent state — it only
// calls the store's existing addDataset/resolveDatasets actions.

import { toast } from "../store/toasts";
import { nextDatasetId, useApp } from "../store/useApp";
import { is2DMap } from "./mapdata";
import { buildSelectionOverlay } from "./originOverlay";
import type { Dataset } from "./types";

const MIN_SELECTION = 2;

/** "— skipped N map dataset(s) (name, name): maps don't overlay", or "" when
 *  nothing was skipped. Shared by both the success and the not-enough-left
 *  toast so the reason is always named, never just a count. */
function mapSkipNote(maps: Dataset[]): string {
  if (maps.length === 0) return "";
  const noun = maps.length === 1 ? "map dataset" : "map datasets";
  return ` — skipped ${maps.length} ${noun} (${maps.map((d) => d.name).join(", ")}): maps don't overlay`;
}

/** Combine `ids` into one overlay plot, one curve per dataset. Requires ≥2
 *  selected datasets up front (toast + return otherwise); 2-D maps within an
 *  otherwise-valid selection are skipped (named in the toast) rather than
 *  failing the whole command, since the remaining datasets can still overlay
 *  fine. Exported so every entry point (palette/menu command, Library
 *  context menu) calls the identical gate + build + land sequence. */
export async function plotSelectedTogether(ids: readonly string[]): Promise<void> {
  if (ids.length < MIN_SELECTION) {
    toast(`select at least ${MIN_SELECTION} datasets to plot together`, "danger");
    return;
  }
  // #38-style deferred edge: a still-pending Origin book (lazy multi-book
  // import) must be fully loaded before its channels/rows are readable —
  // An append (lib/transformRun.runTransform, the Reshape & combine commit)
  // resolves the same way before combining.
  // Every entry point fires this as `void …`, so a rejected resolve must be
  // reported here or it is invisible (silent-failure audit 2026-10-01).
  let resolved: Dataset[];
  try {
    resolved = await useApp.getState().resolveDatasets([...ids]);
  } catch (e) {
    toast(`couldn't load the selected datasets to plot together — ${e instanceof Error ? e.message : "error"}`, "danger");
    return;
  }
  if (resolved.length < MIN_SELECTION) {
    toast("couldn't resolve enough of the selected datasets to plot together", "danger");
    return;
  }
  const maps = resolved.filter((d) => is2DMap(d.data));
  const plottable = resolved.filter((d) => !is2DMap(d.data));
  if (plottable.length < MIN_SELECTION) {
    toast(
      `need at least ${MIN_SELECTION} plottable datasets to overlay${mapSkipNote(maps)}`,
      "danger",
    );
    return;
  }
  const data = buildSelectionOverlay(plottable);
  if (!data) {
    toast("couldn't build an overlay from the selected datasets", "danger");
    return;
  }
  useApp.getState().addDataset({ id: nextDatasetId(), name: `overlay (${plottable.length})`, data });
  const units = xUnitMismatch(plottable);
  toast(`plotted ${plottable.length} datasets together${units}${mapSkipNote(maps)}`, units ? "info" : "ok");
}

/** " — x units differ (Oe, K)" when the sources' x units disagree, else "".
 *  The overlay shares ONE x axis titled from the first source. */
function xUnitMismatch(datasets: Dataset[]): string {
  const units = [...new Set(datasets.map((d) => String(d.data.metadata?.x_column_unit ?? "").trim()))];
  return units.length > 1 ? ` — x units differ (${units.map((u) => u || "none").join(", ")})` : "";
}
