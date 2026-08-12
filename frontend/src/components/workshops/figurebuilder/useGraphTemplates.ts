// User graph templates (#15) -- the STYLE half of a figure configuration
// (preset, publication overrides, per-series styles), saved to localStorage
// and appliable to any other figure. Extracted from useFigureBuilder.ts,
// which sits on a hard module-size pin that every new canonical slice has to
// fund by moving a cohesive block out first (legacyFigure.ts did it for
// F2.3d, canonicalReadiness.ts for F2.3c).
//
// This is legacy-mode-only by nature: a template writes back through the
// legacy `setStyle`/`setOverrides`/`setDocSeriesStyles` setters, and the
// Save/Apply UI itself only renders when `!f.canonical` (FigureBuilderView).
// A canonical draft's equivalent is F4's semantic recipes, not this.

import { useState } from "react";

import {
  deleteGraphTemplate,
  loadGraphTemplates,
  saveGraphTemplate,
  type GraphTemplate,
} from "../../../lib/figuredoc";
import { buildExportStyles, type ExportSeriesStyle } from "../../../lib/exportStyles";
import { compactOverrides, type FigureOverrides } from "../../../lib/figureOverrides";
import type { LegacyFigureState } from "./legacyFigure";

export interface GraphTemplatesApi {
  graphTemplates: GraphTemplate[];
  saveStyleTemplate: (name: string) => void;
  applyStyleTemplate: (name: string) => void;
  removeStyleTemplate: (name: string) => void;
}

export function useGraphTemplates(deps: {
  /** The same bundle the preview request is built from, so a saved template
   *  carries exactly the styling the user is looking at. */
  legacy: LegacyFigureState;
  setStyle: (next: string) => void;
  setOverrides: (next: FigureOverrides) => void;
  setDocSeriesStyles: (next: (ExportSeriesStyle | null)[] | null | undefined) => void;
  setStatus: (message: string) => void;
}): GraphTemplatesApi {
  const [graphTemplates, setGraphTemplates] = useState<GraphTemplate[]>(() => loadGraphTemplates());
  const { legacy } = deps;

  function saveStyleTemplate(name: string): void {
    if (!legacy.data) return;
    const plotted = legacy.yKeys ?? legacy.data.labels.map((_, index) => index);
    setGraphTemplates(
      saveGraphTemplate({
        name,
        style: legacy.style,
        overrides: compactOverrides(legacy.overrides),
        seriesStyles: buildExportStyles(plotted, legacy.seriesStyles),
      }),
    );
    deps.setStatus(`graph template "${name}" saved`);
  }

  function applyStyleTemplate(name: string): void {
    const template = graphTemplates.find((candidate) => candidate.name === name);
    if (!template) return;
    deps.setStyle(template.style);
    deps.setOverrides(template.overrides ?? {});
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
