// Pure projection from a resolved Plot Recipe into a fresh PlotView. Callers
// supply the reference-line id source so this library module never imports
// application state.
import { fixedLim } from "./axisLim";
import { errKeysFromBindings } from "./errorRoles";
import { defaultPlotView, type PlotView } from "./plotview";
import type { ResolvedRecipeMapping, ResolvedRecipePanels, ResolvedRecipeVisual } from "./plotRecipeMatch";

export function resolvedRecipeView(
  mapping: ResolvedRecipeMapping,
  visual: ResolvedRecipeVisual,
  nextRefLineId: () => string,
  panels: ResolvedRecipePanels | null = null,
): PlotView {
  return {
    ...defaultPlotView(),
    ...(panels ? { stackMode: true, panelFit: panels.panelFit, pageSetup: panels.pageSetup } : {}),
    xKey: mapping.xKey,
    yKeys: mapping.yKeys,
    y2Keys: mapping.y2Keys,
    groupKey: mapping.groupKey,
    facetKey: mapping.facetKey,
    errKeys: errKeysFromBindings(mapping.errors),
    xScale: visual.xScale,
    yScale: visual.yScale,
    y2Scale: visual.y2Scale,
    xLim: visual.xRange.mode === "fixed" ? visual.xRange.lim : null,
    xStep: visual.xRange.mode === "fixed" ? (visual.xRange.step ?? null) : null,
    yLim: visual.yRange.mode === "fixed" ? visual.yRange.lim : null,
    yStep: visual.yRange.mode === "fixed" ? (visual.yRange.step ?? null) : null,
    y2Lim: visual.y2Range.mode === "fixed" ? fixedLim(visual.y2Range.lim) : null,
    y2Step: visual.y2Range.mode === "fixed" ? (visual.y2Range.step ?? null) : null,
    xFmt: visual.xFmt,
    yFmt: visual.yFmt,
    y2Fmt: visual.y2Fmt,
    showLegend: visual.showLegend,
    legendPos: visual.legendPos,
    legendXY: visual.legendXY,
    legendSize: visual.legendSize,
    legendTitle: visual.legendTitle,
    legendStatic: visual.legendStatic,
    stackMode: visual.stackMode,
    waterfall: visual.waterfall,
    waterfallDx: visual.waterfallDx,
    plotTemplate: visual.plotTemplate,
    seriesStyles: visual.seriesStyles,
    seriesLabels: visual.seriesLabels,
    seriesOrder: visual.seriesOrder,
    hiddenChannels: visual.hiddenChannels,
    annotations: visual.decorations.annotations,
    shapes: visual.decorations.shapes,
    regionShades: visual.decorations.regionShades,
    refLines: visual.refLines.map((line) => ({ ...line, id: nextRefLineId() })),
  };
}
