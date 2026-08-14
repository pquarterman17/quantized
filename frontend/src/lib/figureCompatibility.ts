// Compatibility reports for transitions between Quantized's current figure
// models. These adapters are intentionally partial until FigureDocument lands;
// keep every user-facing loss inventory here so entry points cannot drift into
// silently dropping different sets of state.

import { docRenderable, type FigureDoc } from "./figuredoc";
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

/** Saved FigureDoc → fresh interactive PlotWindow (the current inverse
 *  bridge). `config.errors` (ORIGIN_GAP_PLAN #51's Graph Builder error
 *  wells) is deliberately NOT audited here as a loss: openFigureDocInWindow
 *  (useApp.ts, item 3) applies it onto the opened window's document via
 *  withWindowDocumentErrors instead of dropping it -- see
 *  figureCompatibility.test.ts's coupled test for the contract this depends
 *  on staying true. */
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

/** Saved FigureDoc -> its canonical FigureDocument promotion (F0.3's third
 *  surface: figureLifecycle.ts's `promoteLegacyFigureDoc`, via
 *  `figureDocumentFromLegacyFigureDoc` in figureDocumentPublication.ts).
 *
 *  Audited line by line: every `FigureConfig` field the adapter reads
 *  (channels, scales, labels, group, output settings, overrides,
 *  seriesStyles, errors) carries into the new document -- most of it
 *  verbatim, so a plain figure promotes with an EMPTY report. One real gap
 *  remains, confirmed against the adapter's actual code, not assumed:
 *
 *  A frozen doc always promotes with `bindings.datasetId: null`
 *  (figureDocumentPublication.ts -- deliberate, "never a coincidentally
 *  active live dataset"), even when the source still names a resolvable
 *  one. The copy keeps rendering its snapshot fine; it just can't be
 *  re-bound to that dataset's live data afterward.
 *
 *  F2.1i (2026-08-12) closed the second gap this audit originally found:
 *  `config.overrides.shapes`/`.ref_lines` now decompose into
 *  `plot.view.shapes`/`.refLines` at promotion time, so the Shapes (F2.3c)
 *  and Reference-lines (F2.3d) panels see the exact objects the export
 *  renders, not an empty list -- see figureDocumentPublication.ts. F2.3j
 *  (2026-08-13) closed the same gap for `region_shades`, once
 *  `RegionShadesCard`/`RegionShadePropertiesPanel` gave it a view editor
 *  too. `seriesStyles` deliberately still copies raw and is NOT a loss: it
 *  stays an exact, un-decomposed array on purpose -- see
 *  figureDocumentPublication.ts's own doc for why a legacy array can't
 *  decompose losslessly into per-channel view styles, and F2.1a's "exact
 *  export styles" contract every other FigureDocument producer already
 *  honors the same way.
 *
 *  `FigureConfig` never stored tick formats, a Y2 assignment, tick steps,
 *  hidden/order state, page setup, or a mark choice at all, so promoting
 *  those is not a loss -- there is nothing on the source to drop. */
export function figureDocPublicationCompatibility(
  doc: FigureDoc,
  datasetIds: ReadonlySet<string>,
): FigureTransitionCompatibility {
  if (!docRenderable(doc, datasetIds)) {
    return {
      blocker: doc.live ? "source dataset is unavailable" : "frozen data snapshot is unavailable",
      losses: [],
    };
  }

  const losses = new Set<string>();
  if (!doc.live && doc.datasetId !== null) {
    losses.add("live dataset link (the copy keeps only the frozen snapshot)");
  }
  return { blocker: null, losses: [...losses] };
}

export function figureTransitionWarning(losses: readonly string[]): string {
  return `These settings will not transfer: ${losses.join("; ")}. The saved source will remain unchanged.`;
}
