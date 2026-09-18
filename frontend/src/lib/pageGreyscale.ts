// PRIMARY_SOFTWARE_AUDIT_PLAN P3.3: the ONE place a page-wide "print safe"
// choice becomes wire bytes. `/api/export/figure-page` takes greyscale PER
// PANEL (`PagePanelSpec.figure.greyscale` -> `calc.figure_page.PagePanel`,
// so a page CAN mix a grey panel next to a coloured one), but neither
// PageDocument-rooted export path offers per-panel UI: the Figure Page
// composer has one always-visible checkbox, and Library's "export a saved
// page without reopening it" reads the saved `PageOutputSettings` — so "on"
// means "on for every panel of this page".
//
// Pure (types only, no store/fetch imports) and shared by BOTH of those
// paths — `components/workshops/figurepage/panelResolve.ts`'s
// `buildPageSpecFromDocument` (the Library path) and
// `usePagePreviewExport.ts`'s `buildSpec` (the composer's preview, file
// export and clipboard copy alike) — rather than each spreading the literal
// itself, which is how the two would drift.
import type { FigurePageSpec } from "./api/figurePage";

/** Apply a page-wide greyscale choice to every panel's own figure spec.
 *
 *  Returns `spec` UNCHANGED (same reference) when greyscale is off or
 *  absent, so a coloured export stays byte-identical to what it sent before
 *  this option existed — the same omit-when-false convention
 *  `lib/figureSpec.ts` uses for the single-figure route
 *  (`...(o.greyscale ? { greyscale: true } : {})`), and the reason the flag
 *  is never sent as `greyscale: false`.
 *
 *  A faceted panel is a documented no-op: `FigureSpec.greyscale` never
 *  applies once `.facets` is set (`calc.figure_facets` renders its own
 *  grid), so such a panel keeps its colours — stated here rather than
 *  silently true. */
export function withPageGreyscale(spec: FigurePageSpec, greyscale: boolean | undefined): FigurePageSpec {
  if (!greyscale) return spec;
  return {
    ...spec,
    panels: spec.panels.map((panel) => ({ ...panel, figure: { ...panel.figure, greyscale: true } })),
  };
}
