// The Stage views the single-figure export does NOT reproduce, made explicit.
//
// "Export figure…", "Copy figure" and "Send figure to report" all post one
// `FigureSpec` (`lib/figureSpecStage.buildStageFigureSpec`). Two views draw
// something that request cannot carry, and both used to export silently
// without it:
//   - the per-channel STACK (`stackMode`; PlotStage mounts MultiPanelStage)
//     and an Origin spatial arrangement under it — the request is one
//     overlaid plot;
//   - the magnifier INSET (`insetMode`) of a DUAL-Y plot. Any other inset
//     rides the request (`overrides.inset`, lib/inset.ts) and the export
//     draws it as the screen does; a secondary axis has no inset there yet,
//     so `gateY2Overrides` drops it and this says so.
// "Export figure…" now draws a plain per-channel stack as its own panels on
// the figure-page route (`lib/stackPageExport.ts`) and never reaches this
// for one; Copy figure and Send to report still post the one request, so for
// them (and an inset, or a spatial page under the stack) the export says what
// it will produce and lets the user cancel (owner rule: silent wrong output
// is the bug). Views that DO export faithfully never ask: polar
// (`lib/polarFigureSpec.ts`), facets (the spec carries `facets`) and an x-break
// (the flat figure plus `x_breaks`, by design). Stat mode routes to the stat
// stage's own export first (`lib/statStageBridge.ts`); reaching this XY
// request in stat mode means no stat stage was there to route to, so it asks.
// Imported only by lazily-loaded export modules.

import type { FigureSpec } from "./api/figures";
import { spatialPanelsOf, type Composition } from "./composition";
import { askConfirm } from "../store/confirmDialog";

export interface ScreenOnlyView {
  polarMode: boolean;
  statMode: boolean;
  stackMode: boolean;
  insetMode: boolean;
  composition: Composition | null;
}

export const STACK_EXPORT_NOTICE = "Stacked panels are screen-only, so this exports one overlaid plot.";
export const INSET_EXPORT_NOTICE = "A dual-Y plot's magnifier inset is screen-only, so this exports the plot without it.";
export const STAT_EXPORT_NOTICE = "The statistics plot isn't ready to export, so this exports the data as an XY plot.";

/** The one-sentence notice for a view whose export differs from the screen,
 *  or null when the export is what the screen shows. */
export function screenOnlyExportNotice(st: ScreenOnlyView, spec: FigureSpec): string | null {
  if (st.polarMode || spec.polar) return null;
  if (st.statMode) return STAT_EXPORT_NOTICE;
  if (spec.facets) return null;
  const composition = st.composition ?? null; // a partial store snapshot may omit it
  // Only the WIRE's breaks count: a cached break whose rows were excluded away
  // no longer draws on screen (`useEffectiveComposition`), so it says nothing.
  if (spec.overrides?.x_breaks?.length) return null;
  // PlotStage's stack gate (`multiPanelShowing`): two or more series, or a spatial page.
  const series = spec.y_keys?.length ?? spec.dataset.labels.length;
  if (st.stackMode && (series >= 2 || (spatialPanelsOf(composition)?.length ?? 0) >= 2)) {
    return STACK_EXPORT_NOTICE;
  }
  return st.insetMode && !spec.overrides?.inset ? INSET_EXPORT_NOTICE : null;
}

/** Ask before exporting a screen-only view; true = go ahead (also when there
 *  is nothing to say). */
export async function confirmScreenOnlyExport(
  st: ScreenOnlyView,
  spec: FigureSpec,
  verb: "Export" | "Copy" | "Send",
): Promise<boolean> {
  const notice = screenOnlyExportNotice(st, spec);
  return notice === null || askConfirm("Not what the screen shows", notice, `${verb} anyway`);
}
