// The figures-audit dialogs' store reads and commits (#6 Axis dialog, #8
// plot-type gallery), kept out of the components so they stay selector-only
// in render (architecture.test.ts's getState()-in-render ratchet). Only the
// lazy FigureDialogs chunk imports this module.

import { applyWaterfall } from "../commands/waterfallCommand";
import type { AxisId } from "../store/figureDialogs";
import { useApp } from "../store/useApp";
import { setPlots2Mode, type Plots2Kind } from "./plots2Mode";
import { setPolarMapMode } from "./polarMapMode";
import { openAuxFigure } from "./ternaryPending";
import { axisDraft, type AxisDraft } from "./axisDialogModel";
import { PLOT_TYPE_COMMANDS, PLOT_TYPES, plotTypePatch, plotTypeUnavailable, type PlotTypeId } from "./plotTypes";
import { effectiveChannels } from "./plotdata";
import { PLOT_PRESETS, plotPresetPatch, plotPresetUnavailable, type PlotPresetId } from "./plotTypePresets";

/** The live view's settings for `axis`, as an editable draft. */
export function currentAxisDraft(axis: AxisId): AxisDraft {
  return axisDraft(useApp.getState(), axis);
}

/** Y2's draft as it would be with no scale and no tick format of its own
 *  (following Y): what "Same format as Y" resets the fields to. */
export function followingY2Draft(): AxisDraft {
  return axisDraft({ ...useApp.getState(), y2Scale: null, y2Fmt: null }, "y2");
}

/** Switch the focused graph to plot type `id` (one undo step). The ternary
 *  builder lives in components/, so its caller passes the opener. */
export function applyPlotType(id: PlotTypeId, openTernary?: () => void, presetId?: PlotPresetId): void {
  const s = useApp.getState();
  const dataset = s.datasets.find((d) => d.id === s.activeId) ?? null;
  if (plotTypeUnavailable(id, dataset) || !dataset) return;
  const preset = presetId ? PLOT_PRESETS.find((p) => p.id === presetId) : undefined;
  if (presetId && (!preset || preset.parent !== id || plotPresetUnavailable(presetId, dataset))) return;
  const label = preset?.label ?? PLOT_TYPES.find((t) => t.id === id)?.label ?? id;
  setPolarMapMode(id === "polarMap"); // the polar Stage shows the map only for its own tile
  const PLOTS2: readonly PlotTypeId[] = ["parallel", "hexbin", "kde2d", "pareto", "blandAltman"];
  setPlots2Mode(PLOTS2.includes(id) ? (id as Plots2Kind) : null); // the Stage swaps for the G15 plots only on their own tiles
  if (PLOTS2.includes(id)) {
    s.setStageTab("plot");
    s.setStatus(`plot type: ${label}`);
    return;
  }
  if (id === "contour") {
    s.setContourOn(true);
    s.setStageTab("map");
    s.setStatus(`plot type: ${label}`);
    return;
  }
  if (PLOT_TYPE_COMMANDS.has(id)) {
    // Gap-audit-2 #17: these open the tool the app already has for them.
    if (id === "waterfall") void applyWaterfall();
    else if (id === "ternary" || id === "ternaryMap") openTernary?.();
    else if (id === "pie") openAuxFigure("pieOpen"); // labels = the X column, wedges = the first channel; the workshop re-picks
    else s.setStackMode(true);
    s.setStageTab("plot");
    s.setStatus(`plot type: ${label}`);
    return;
  }
  const plotted = effectiveChannels(dataset.data, s.yKeys, s.xKey, dataset.channelRoles, s.seriesOrder);
  if (id === "doubleY" && plotted.length < 2) {
    s.setStatus("Double-Y: plot at least two Y columns first");
    return;
  }
  s.recordHistory(`plot type: ${label.toLowerCase()}`);
  const patch = presetId ? plotPresetPatch(presetId, s, plotted) : plotTypePatch(id, s, plotted);
  useApp.setState({ ...patch, stageTab: "plot" });
  s.setStatus(presetId === "stackedHist" && plotted.length < 2 ? "Stacked histogram needs two or more plotted Y columns to stack; this is the plain histogram" : `plot type: ${label}`);
}

/** Apply a variant preset: its parent type plus its fixed options, as ONE undo
 *  step (lib/plotTypePresets.ts). */
export function applyPlotPreset(id: PlotPresetId): void {
  const parent = PLOT_PRESETS.find((p) => p.id === id)?.parent;
  if (parent) applyPlotType(parent, undefined, id);
}
