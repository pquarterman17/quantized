// The Publication Preview's click-to-select and double-click-to-edit
// dispatch: which #11 panel group a hitmapped element focuses, and which
// config field a double-click commits into. Extracted from
// useFigureBuilder.ts's selectElement/editElementText/textOf to fund F2.3h's
// grouping panel -- the hook had zero headroom under its 500-line ceiling,
// same shape as F2.4e/F2.3f's `previewDrag.ts` extraction: pure logic over
// injected state, the hook keeps only thin binding wrappers.

import { groupForElement } from "../../../lib/previewmap";
import type { FigureViewState } from "../../../lib/figureDocument";

/** The live state select/edit/textOf read and write -- bound by the hook. */
export interface PreviewSelectDeps {
  setFocusGroup: (group: string | null) => void;
  setFocusNonce: (updater: (n: number) => number) => void;
  canonical: boolean;
  canonicalView: FigureViewState | null;
  setCanonicalView: (patch: Partial<FigureViewState>) => void;
  title: string;
  setTitle: (next: string) => void;
  xLabel: string;
  setXLabel: (next: string) => void;
  yLabel: string;
  setYLabel: (next: string) => void;
}

/** Click: focus the matching panel group. Always bumps the nonce so a
 *  re-selection of the same group's element reopens a manually-collapsed
 *  panel instead of being a no-op. F2.3b: a rendered "series:N" hitbox is
 *  special-cased straight to the Series group -- `groupForElement`
 *  deliberately stays null for it (per-series styles have no single
 *  N->channel mapping without the hitmap's plotted-position order). */
export function selectPreviewElement(deps: PreviewSelectDeps, id: string): void {
  deps.setFocusGroup(id.startsWith("series:") ? "Series" : groupForElement(id));
  deps.setFocusNonce((n) => n + 1);
}

/** Double-click inline edit commits straight into the config fields. */
export function editPreviewElementText(deps: PreviewSelectDeps, id: string, value: string): void {
  if (id === "title") {
    if (deps.canonical) deps.setCanonicalView({ plotTitle: value });
    else deps.setTitle(value);
  } else if (id === "xlabel") {
    if (deps.canonical) deps.setCanonicalView({ xAxisLabel: value });
    else deps.setXLabel(value);
  } else if (id === "ylabel") {
    if (deps.canonical) deps.setCanonicalView({ yAxisLabel: value });
    else deps.setYLabel(value);
  }
}

export function previewElementText(deps: PreviewSelectDeps, id: string): string {
  return id === "title"
    ? (deps.canonicalView?.plotTitle ?? deps.title)
    : id === "xlabel"
      ? (deps.canonicalView?.xAxisLabel ?? deps.xLabel)
      : id === "ylabel"
        ? (deps.canonicalView?.yAxisLabel ?? deps.yLabel)
        : "";
}
