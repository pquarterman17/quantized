// Canonical-mode overrides bridge (bug fix: preview/editor overrides
// mismatch). The rendered publication preview is the MERGE of view-derived
// overrides (legend position, annotations placed on the Stage, grid, spines,
// …, from the document's PlotView) and the publication-only delta — see
// `buildFigureSpecForView`'s `mergeFigureOverrides(withBreaks,
// extras.publicationOverrides)` in lib/figureSpec.ts. Property panels and
// drag interactions previously read/wrote ONLY `publication.overrides` (the
// delta), so a view-derived annotation or legend position the preview showed
// was invisible to the panels and silently un-draggable (an out-of-range
// array index against the empty delta). These two functions give both sides
// the SAME merge: read the effective (rendered) overrides, write back only
// what actually changed. Pure — no store import.

import type { FigureDocument } from "../../../lib/figureDocument";
import { compactOverrides, mergeFigureOverrides, type FigureOverrides } from "../../../lib/figureOverrides";
import { viewOverrides } from "../../../lib/figureSpec";

/** The overrides the canonical preview actually renders with. Mirrors
 *  `buildFigureSpecForView`'s merge minus the two render-time-only extras
 *  that never round-trip through the property panels: `x_breaks` (derived
 *  from `document.plot.axisBreaks`, edited elsewhere) and `margins` (derived
 *  from `pageSetup`). */
export function effectiveFigureOverrides(
  view: Parameters<typeof viewOverrides>[0],
  publication: FigureOverrides | null | undefined,
): FigureOverrides {
  return mergeFigureOverrides(viewOverrides(view), publication) ?? {};
}

/** The minimal `publication.overrides` write for one property-panel/drag
 *  edit: a top-level key only enters the write-set when `next` actually
 *  differs from what was rendered (`effective`). Keys the user did not touch
 *  are left out entirely — including ones only present because the VIEW set
 *  them — so they keep tracking the view instead of getting pinned into the
 *  publication delta the moment any sibling field is edited.
 *
 *  Limitation: clearing a view-derived value (present in `effective` because
 *  the view set it, absent from `next`) cannot be represented in this delta
 *  model. Diffing still detects the change and writes `key: undefined` into
 *  the merge below, which `compactOverrides` drops — but an ABSENT
 *  publication key means "derive from the view" on the next render, so the
 *  cleared value simply reappears. There is no "erase the view's value from
 *  the canonical preview" operation here; the user has to change it on the
 *  Stage itself. */
export function publicationOverridesDelta(
  effective: FigureOverrides,
  next: FigureOverrides,
  currentPublication: FigureOverrides | null | undefined,
): FigureOverrides | null {
  const keys = new Set<keyof FigureOverrides>([
    ...(Object.keys(effective) as (keyof FigureOverrides)[]),
    ...(Object.keys(next) as (keyof FigureOverrides)[]),
  ]);
  const writeSet = {} as Record<keyof FigureOverrides, unknown>;
  for (const key of keys) {
    if (JSON.stringify(next[key]) !== JSON.stringify(effective[key])) {
      writeSet[key] = next[key];
    }
  }
  return compactOverrides({ ...currentPublication, ...(writeSet as FigureOverrides) });
}

/** Item 3: x-axis breaks have two possible homes on a canonical document.
 *  `buildFigureSpecFromDocument` emits `plot.axisBreaks.x`; a legacy-imported
 *  document can also carry `publication.overrides.x_breaks`, which otherwise
 *  REPLACES `axisBreaks` wholesale in `mergeFigureOverrides` (see that
 *  function above) -- so a document that somehow carries both disagrees with
 *  itself about which one renders. Reading prefers the publication delta
 *  (what the preview actually shows); writing migrates the edited value into
 *  the canonical `axisBreaks.x` home and drops the publication key, so panel
 *  edits and the rendered figure cannot diverge again after one edit. */
export function effectiveXBreaks(document: FigureDocument): [number, number][] {
  return document.publication?.overrides?.x_breaks ?? document.plot.axisBreaks.x;
}

export function migrateXBreaksPatch(
  document: FigureDocument,
  next: [number, number][],
): FigureDocument {
  return {
    ...document,
    plot: { ...document.plot, axisBreaks: { ...document.plot.axisBreaks, x: next } },
    publication: {
      ...document.publication,
      overrides: compactOverrides({ ...document.publication?.overrides, x_breaks: undefined }),
    },
  };
}
