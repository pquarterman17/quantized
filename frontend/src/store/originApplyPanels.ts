// The spatial multi-panel half of the Origin-figure apply (decode-plan #36),
// split out of `store/originApplyRun.ts` for the 500-line ceiling, plus the
// per-layer overlays that let a multi-layer window whose layers plot several
// books each keep every panel (B1: "Fixed Lambdas SI" Graph5/6, two stacked
// layers of 4 and 6 books, used to show only the clicked layer).
//
// Lazy like its caller: only `originApplyRun.ts` imports it, so it rides the
// same on-demand chunk (`store/originApplyLibs.ts`).

import { spatialComposition } from "../lib/composition";
import { figureLabel, type OriginFigureEntry } from "../lib/originFigures";
import { buildOverlayDataset, originOverlayDataset, topAxisPatch } from "../lib/originOverlayFigure";
import { originDividePatch } from "../lib/originTickDivide";
import { pageSetupFromDecoded } from "../lib/pageGeometry";
import type { Dataset } from "../lib/types";
import { lit } from "../lib/macro";
import { nextDatasetId } from "./idSeq";
import type { OriginApplyLibs } from "./originApplyLibs";
import { ORIGIN_FIGURE_AXIS, ORIGIN_FIGURE_MODE_RESET, ORIGIN_FIGURE_Y2_RESET } from "./originApplyState";
import { toast } from "./toasts";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

/** One overlay dataset per family member whose curves span >= 2 books (or
 *  >= 2 X blocks), and the family re-pointed at them; null when no member
 *  needs one (the plain per-book panels already cover it). Built only: the
 *  caller commits `datasets` once the layout is known to be trustworthy.
 *  Each overlay is stamped with ITS layer as both source and entry, so a
 *  re-apply refreshes it in place and the Library's open/re-apply guards
 *  (`libraryOpen`, `confirmOriginReapplyDiscard`) see it as that layer's. */
export function layerOverlays(
  family: OriginFigureEntry[],
  siblings: Dataset[],
  datasets: Dataset[],
): { family: OriginFigureEntry[]; datasets: Dataset[] } | null {
  const staged: Dataset[] = [];
  const mapped = family.map((member) => {
    const data = buildOverlayDataset(member.figure, siblings);
    if (!data) return member;
    const existing = datasets.find((d) => {
      const meta = d.data.metadata ?? {};
      return meta.origin_overlay_source === member.id && meta.origin_overlay_entry === member.id;
    });
    const name = `${member.stem}:${figureLabel(member)} (overlay)`;
    // `origin_overlay_panel` marks it as rebuilt by EVERY apply of its window
    // (the re-apply discard check, `confirmOriginReapplyDiscard`, asks for it).
    const marked = { ...data, metadata: { ...data.metadata, origin_overlay_panel: true } };
    const ds = originOverlayDataset(existing?.id ?? nextDatasetId(), name, marked, member.id, member.id, existing);
    staged.push(ds);
    return { ...member, datasetId: ds.id };
  });
  return staged.length ? { family: mapped, datasets: staged } : null;
}

/** Apply `family` (>= 2 resolved layers) as spatial panels; false when any
 *  layer does not resolve (the caller falls back). With `staged` overlays the
 *  apply also requires a TRUSTED layout (decoded tiled or page geometry, no
 *  dropped overlay layer): otherwise nothing is committed and the caller's
 *  older single-layer overlay apply runs, as before B1. */
export function applySpatialPanels(
  set: SliceSet,
  get: SliceGet,
  entry: OriginFigureEntry & { datasetId: string },
  id: string,
  figName: string,
  family: OriginFigureEntry[],
  libs: OriginApplyLibs,
  staged: Dataset[] = [],
): boolean {
  const stagedIds = new Set(staged.map((d) => d.id));
  const pool = [...get().datasets.filter((d) => !stagedIds.has(d.id)), ...staged];
  const spatialResult = libs.resolveSpatialPanels(family, pool);
  if (!spatialResult) return false;
  const { panels: placed, layout, droppedOverlays } = spatialResult;
  if (staged.length && (layout === "ordinal" || droppedOverlays > 0)) return false;
  if (staged.length) {
    set((s) => {
      const known = new Set(s.datasets.map((d) => d.id));
      return {
        datasets: [
          ...s.datasets.map((d) => staged.find((x) => x.id === d.id) ?? d),
          ...staged.filter((d) => !known.has(d.id)),
        ],
      };
    });
  }
  get().setActive(entry.datasetId);
  // showAxisBox is the SINGLETON flag `useMultiPanelStage` reads for
  // every spatial panel (item 4) — Origin layers are boxed by default.
  set({
    ...ORIGIN_FIGURE_MODE_RESET,
    ...ORIGIN_FIGURE_Y2_RESET,
    stackMode: true,
    composition: spatialComposition(placed),
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
    ...originDividePatch(get(), {}, topAxisPatch(get().xFmt).xFmt), // panels carry their own factors
    hiddenChannels: [],
    // Spatial bands live on each SpatialPanel; clear only the singleton
    // overlay list so a prior single plot cannot leak into this view.
    regionShades: [],
  });
  get().recordMacro(`Apply figure ${lit(figName)}`, `qz.applyFigure(${lit(id)})`);
  for (const msg of libs.spatialApplyNotices(layout, placed.length, droppedOverlays)) toast(msg, "info");
  return true;
}
