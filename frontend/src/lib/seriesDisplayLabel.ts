// The finished legend text for one series — the BUG-014 product rule, in
// its own module because it is the ONLY part of `lib/figureSpecSeries.ts`
// the eager plot-encoding path (`Stage/usePlotEncoding.ts`,
// `lib/plotEncoding.ts`) needs. Rollup places a module in its eager
// importer's chunk whole, so this one-liner was carrying that module's five
// lazy-only exports into first-paint JS (~1.2 kB measured 2026-09-30 by
// sourcemap attribution). Same shape as the other eager-bytes extractions
// (`architecture.test.ts`); nothing here changed.
import { withUnit } from "./uplotOpts";

/**
 * The finished legend text for ONE series, by the BUG-014 product rule: a
 * rename is used VERBATIM (unit included or not, exactly as typed), and only
 * an un-renamed channel gets the derived `"label (unit)"` composition.
 *
 * This is the SAME resolution three other places already spell out —
 * `uplotOpts.buildOpts` (`args.seriesLabels?.[i] ?? (unit ? ... : label)`),
 * the backend's `calc.figure_labels.series_display_name`, and the flat
 * export path's `withSeriesLegends` + `series_styles[i].legend` pair. The
 * flat wire can defer the composition to the renderer because it ships the
 * data labels and the override separately; a FACET panel cannot — it ships
 * FINISHED strings (`FigureFacetSeries.label`) that no per-series field on
 * the request can reach — so it has to compose here, and it must compose the
 * same way or a renamed facet panel exports "Loop 1 (au)" while the screen
 * reads "Loop 1" (BUG-014's own symptom, which survived in the facet branch
 * until this existed).
 *
 * An EMPTY rename is honoured verbatim, matching `??` on the screen side.
 */
export function seriesDisplayLabel(label: string, unit: string, legend: string | undefined): string {
  return legend ?? withUnit(label, unit);
}
