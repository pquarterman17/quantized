// User graph templates (#15) -- the STYLE half of a figure configuration
// (preset, publication overrides, per-series styles), saved to localStorage
// and appliable to any other figure. Extracted from useFigureBuilder.ts,
// which sits on a hard module-size pin that every new canonical slice has to
// fund by moving a cohesive block out first (legacyFigure.ts did it for
// F2.3d, canonicalReadiness.ts for F2.3c).
//
// Both modes (figures-audit B2 -- this used to be legacy-only, so the
// default canonical Publication preview had no style templates at all):
//   - legacy: writes back through the legacy `setStyle`/`setOverrides`/
//     `setDocSeriesStyles` setters, as before;
//   - canonical: writes the draft's style preset, its publication overrides
//     (through the same view+publication delta bridge every other canonical
//     edit uses) and the Stage-side `format` (`lib/graphFormat.ts`: axis
//     scales/formats, chrome, series styles by POSITION) into the draft view.
// The template record is shared with the Stage's "Save/Apply Graph
// Template…" (`lib/graphTemplateCommands.ts`), so either side's templates
// apply on the other. Style only: no data binding travels -- nor a limit or
// a data-anchored decoration from the overrides (lib/graphTemplateOverrides.ts).

import { useState } from "react";

import {
  deleteGraphTemplate,
  loadGraphTemplates,
  saveGraphTemplate,
  type GraphTemplate,
} from "../../../lib/figuredoc";
import { buildExportStyles, type ExportSeriesStyle } from "../../../lib/exportStyles";
import { compactOverrides, type FigureOverrides } from "../../../lib/figureOverrides";
import type { FigureViewState } from "../../../lib/figureDocument";
import { captureGraphFormat, graphFormatPatch, sanitizeGraphFormat, seriesStyleFromExport } from "../../../lib/graphFormat";
import { applyTemplateOverrides, templateStyleOverrides } from "../../../lib/graphTemplateOverrides";
import type { PlotView } from "../../../lib/plotview";
import { recordUse } from "../../../lib/recipeIndex";
import type { LegacyFigureState } from "./legacyFigure";

export interface GraphTemplatesApi {
  graphTemplates: GraphTemplate[];
  saveStyleTemplate: (name: string) => void;
  applyStyleTemplate: (name: string) => void;
  removeStyleTemplate: (name: string) => void;
}

/** What a canonical draft exposes to templates: its current style preset,
 *  effective overrides, view and plotted channels (display order), and the
 *  draft setters. */
export interface CanonicalTemplateTarget {
  style: string;
  overrides: FigureOverrides;
  view: PlotView;
  plotted: readonly number[];
  setStyle: (next: string) => void;
  setOverrides: (next: FigureOverrides) => void;
  setView: (patch: Partial<FigureViewState>) => void;
}

export function useGraphTemplates(deps: {
  /** The same bundle the preview request is built from, so a saved template
   *  carries exactly the styling the user is looking at. */
  legacy: LegacyFigureState;
  setStyle: (next: string) => void;
  setOverrides: (next: FigureOverrides) => void;
  setDocSeriesStyles: (next: (ExportSeriesStyle | null)[] | null | undefined) => void;
  setStatus: (message: string) => void;
  /** The open canonical draft, or null in legacy mode. */
  canonical: CanonicalTemplateTarget | null;
}): GraphTemplatesApi {
  const [graphTemplates, setGraphTemplates] = useState<GraphTemplate[]>(() => loadGraphTemplates());
  const { legacy } = deps;

  function saveStyleTemplate(name: string): void {
    const target = deps.canonical;
    if (target) {
      setGraphTemplates(
        saveGraphTemplate({
          name,
          style: target.style,
          overrides: compactOverrides(templateStyleOverrides(target.overrides)),
          seriesStyles: buildExportStyles([...target.plotted], target.view.seriesStyles),
          format: captureGraphFormat(target.view, target.plotted),
        }),
      );
      deps.setStatus(`graph template "${name}" saved`);
      return;
    }
    if (!legacy.data) return;
    const plotted = legacy.yKeys ?? legacy.data.labels.map((_, index) => index);
    setGraphTemplates(
      saveGraphTemplate({
        name,
        style: legacy.style,
        overrides: compactOverrides(templateStyleOverrides(legacy.overrides)),
        seriesStyles: buildExportStyles(plotted, legacy.seriesStyles),
      }),
    );
    deps.setStatus(`graph template "${name}" saved`);
  }

  function applyStyleTemplate(name: string): void {
    const template = graphTemplates.find((candidate) => candidate.name === name);
    if (!template) return;
    // P3.5 "recently used" — after the existence guard.
    recordUse({ kind: "graph", scope: "global", id: template.name });
    const target = deps.canonical;
    if (target) {
      target.setStyle(template.style);
      target.setOverrides(applyTemplateOverrides(target.overrides, template.overrides));
      // A template saved before `format` existed (or from an Origin .otp)
      // still restyles the series, from its publication styles.
      const format = sanitizeGraphFormat(template.format) ?? {
        ...captureGraphFormat(target.view, target.plotted),
        series: (template.seriesStyles ?? []).map(seriesStyleFromExport),
      };
      target.setView(graphFormatPatch(format, target.plotted, target.view.seriesStyles, target.view));
      deps.setStatus(`graph template "${name}" applied`);
      return;
    }
    deps.setStyle(template.style);
    deps.setOverrides(applyTemplateOverrides(legacy.overrides, template.overrides));
    // `?? null` is load-bearing: a template with no styles must set the
    // EXPLICIT "this figure has none" sentinel, not `undefined`, which would
    // silently fall back to mirroring the live plot's per-channel styles --
    // i.e. applying a style template would leave the old styling in place.
    deps.setDocSeriesStyles(template.seriesStyles ?? null);
    deps.setStatus(`graph template "${name}" applied`);
  }

  function removeStyleTemplate(name: string): void {
    setGraphTemplates(deleteGraphTemplate(name));
  }

  return { graphTemplates, saveStyleTemplate, applyStyleTemplate, removeStyleTemplate };
}
