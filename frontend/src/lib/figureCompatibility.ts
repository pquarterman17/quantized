// Compatibility reports for transitions between Quantized's current figure
// models. These adapters are intentionally partial until FigureDocument lands;
// keep every user-facing loss inventory here so entry points cannot drift into
// silently dropping different sets of state.

import type { FigureDoc } from "./figuredoc";
import type { PlotSpec } from "./plotspec";
import type { SeriesStyle } from "./types";

export interface FigureTransitionCompatibility {
  blocker: string | null;
  losses: string[];
}

const hasKeys = (value: object | null | undefined): boolean =>
  value !== null && value !== undefined && Object.keys(value).length > 0;

function plotSpecPublicationBlocker(spec: PlotSpec): string | null {
  if (spec.mark !== "line" && spec.mark !== "scatter" && spec.mark !== "step") {
    return "Only line, scatter, and step plots can open in Publication Preview.";
  }
  if (spec.zones.y.length === 0) return "Assign at least one Y channel first.";
  if (spec.zones.facet) return "Faceted plots need a multi-panel Publication Preview contract first.";
  const refs = [spec.zones.x, ...spec.zones.y].filter((ref) => ref !== null);
  const datasetIds = new Set(refs.map((ref) => ref.datasetId));
  if (datasetIds.size !== 1) return "Every plotted channel must belong to one dataset.";
  const usesY2 =
    Object.values(spec.display?.series ?? {}).some((style) => style.axis === 1) ||
    spec.axes?.y2 !== undefined;
  if (usesY2) {
    if (spec.zones.group) {
      return "A group split puts every synthetic per-level series on the primary axis (buildXY never assigns axis: 1) — remove the secondary (Y2) axis assignment before opening in Publication Preview.";
    }
    return "Publication Preview has no secondary (Y2) axis yet — move this series to the primary axis first.";
  }
  return null;
}

/** Graph Builder PlotSpec → the smaller publication-preview FigureDoc. */
export function plotSpecPublicationCompatibility(
  spec: PlotSpec,
  liveSeriesStyles: Record<number, SeriesStyle> = {},
): FigureTransitionCompatibility {
  const blocker = plotSpecPublicationBlocker(spec);
  if (blocker) return { blocker, losses: [] };

  const losses = new Set<string>();
  const series = Object.values(spec.display?.series ?? {});
  if (series.some((style) => style.hidden === true)) losses.add("hidden-series state");
  if ((spec.display?.order?.length ?? 0) > 0) losses.add("custom series order");
  if (series.some((style) => style.markerShape !== undefined)) losses.add("marker shapes");
  if (
    spec.zones.group &&
    (hasKeys(spec.display?.series) || hasKeys(liveSeriesStyles))
  ) {
    losses.add("per-series styling on grouped output");
  }
  if (spec.axes?.x?.step !== undefined || spec.axes?.y?.step !== undefined) {
    losses.add("axis tick spacing");
  }
  if (spec.axes?.x?.fmt !== undefined || spec.axes?.y?.fmt !== undefined) {
    losses.add("axis number formats");
  }
  if (spec.decor?.annotations?.length) losses.add("annotations");
  if (spec.decor?.shapes?.length) losses.add("shapes");
  if (spec.decor?.legend) losses.add("legend placement and title");
  if (spec.page) losses.add("page and panel settings");
  return { blocker: null, losses: [...losses] };
}

/** Saved FigureDoc → fresh interactive PlotWindow (the current inverse bridge). */
export function figureDocPlotCompatibility(doc: FigureDoc): FigureTransitionCompatibility {
  if (!doc.live || !doc.datasetId) {
    return {
      blocker: "Only a live saved figure with a resolved dataset can open as an editable plot.",
      losses: [],
    };
  }

  const losses = new Set<string>();
  const c = doc.config;
  if (c.groupCol !== null && c.groupCol !== undefined) losses.add("grouped-series mapping");
  if (c.seriesStyles?.some((style) => style !== null)) losses.add("series styles");
  if (c.style && c.style !== "default") losses.add("publication style preset");

  const ov = c.overrides;
  if (ov?.x_lim || ov?.y_lim || ov?.y2_lim) losses.add("manual axis ranges");
  if (ov?.legend) losses.add("legend settings");
  if (ov?.annotations?.length) losses.add("annotations");
  if (ov?.shapes?.length) losses.add("shapes");
  if (ov?.ref_lines?.length) losses.add("reference lines");
  if (ov?.region_shades?.length) losses.add("region shades");
  if (ov?.x_breaks?.length) losses.add("axis breaks");
  if (
    ov &&
    (ov.font_size !== undefined ||
      ov.font_name !== undefined ||
      ov.title_size !== undefined ||
      ov.ticks !== undefined ||
      ov.spines !== undefined ||
      ov.margins !== undefined ||
      ov.grid !== undefined)
  ) {
    losses.add("publication fonts, ticks, frame, margins, or grid settings");
  }
  return { blocker: null, losses: [...losses] };
}

export function figureTransitionWarning(losses: readonly string[]): string {
  return `These settings will not transfer: ${losses.join("; ")}. The saved source will remain unchanged.`;
}
