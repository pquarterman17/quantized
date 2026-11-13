// Which publication overrides a graph template carries (figures-audit B2
// review finding). A template is the STYLE of a figure -- fonts, sizes,
// legend, ticks, spines, margins, grid -- and never what it shows. A canonical
// draft's overrides are its EFFECTIVE ones (the view's own limits, reference
// lines, annotations, shapes and shades folded in), so saving them whole
// carried one dataset's data-anchored decorations and axis ranges into every
// figure the template was applied to, and applying replaced the target's own.
//
// Pure; used by the Publication preview's template hook
// (`components/workshops/figurebuilder/useGraphTemplates.ts`).

import type { FigureOverrides } from "./figureOverrides";

/** The overrides that belong to a figure's DATA: axis ranges, and every
 *  decoration placed in data coordinates (or on the data's breaks). */
export const DATA_ANCHORED_OVERRIDES = [
  "x_lim", "y_lim", "y2_lim", "x_breaks", "annotations", "shapes", "ref_lines", "region_shades", "inset",
] as const satisfies readonly (keyof FigureOverrides)[];

type DataKey = (typeof DATA_ANCHORED_OVERRIDES)[number];

function split(o: FigureOverrides | null | undefined, keepData: boolean): FigureOverrides {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o ?? {})) {
    if (DATA_ANCHORED_OVERRIDES.includes(k as DataKey) === keepData) out[k] = v;
  }
  return out as FigureOverrides;
}

/** `o` without its data-anchored overrides: what a template saves. */
export function templateStyleOverrides(o: FigureOverrides | null | undefined): FigureOverrides {
  return split(o, false);
}

/** The target's overrides after applying a template's: the template's style
 *  replaces the target's style, and the target keeps its own limits and
 *  decorations (a template saved before this rule still carries none of the
 *  source's). */
export function applyTemplateOverrides(
  target: FigureOverrides | null | undefined,
  template: FigureOverrides | null | undefined,
): FigureOverrides {
  return { ...split(target, true), ...templateStyleOverrides(template) };
}
