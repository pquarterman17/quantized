// Reflectivity fit — the DREAM credible bands as library datasets (P2.2 slice
// 4). Pure: no React, no store. "Add uncertainty bands" turns a live run's
// R(Q) and SLD(z) percentile bands into datasets named, placed and
// provenanced for the fit exactly like "Add fit curves" (reflFitCurves.ts
// `curveDatasetFor`: `metadata.reflFit` points back at the record), with the
// band's own provenance beside it in `metadata.band`. The plot draws a band
// natively as a fill between two series (SeriesStyle `fill: {vs}`, MAIN #13),
// so the band plot is opened with the 95% and 68% pairs filled.

import type { ReflPosteriorResult } from "../../../lib/api/reflectivity";
import type { Dataset, SeriesStyle } from "../../../lib/types";
import { curveDatasetFor, type CurveDataset } from "./reflFitCurves";
import type { ReflFitRecord } from "./reflFitRecord";

/** R band columns: the measured R, then the model's percentiles. */
export const R_BAND_LABELS = ["R", "R median", "R 2.5%", "R 97.5%", "R 16%", "R 84%"];
/** SLD band columns: the percentiles of the profile. */
export const SLD_BAND_LABELS = ["SLD median", "SLD 2.5%", "SLD 97.5%", "SLD 16%", "SLD 84%"];

/** The band plot's fills, keyed by channel: 2.5% to 97.5%, then 16% to 84%. */
export const R_BAND_FILLS: Record<number, SeriesStyle> = { 2: { fill: { vs: 3 } }, 4: { fill: { vs: 5 } } };

const nan = (v: number | null | undefined): number => v ?? Number.NaN;

/** The library datasets for a run's bands: one per channel (Q, then
 *  `R_BAND_LABELS`) and one per spin state's SLD profile. */
export function bandDatasets(
  res: Pick<ReflPosteriorResult, "r_bands" | "sld_bands" | "convergence">,
  record: ReflFitRecord,
  datasets: readonly Dataset[],
  ranAt: string,
): CurveDataset[] {
  const out = curveDatasetFor(record, datasets);
  const c = res.convergence;
  const band = { percentiles: [2.5, 16, 50, 84, 97.5], draws: c.n_band_draws, ranAt, converged: c.converged, rhatMax: c.rhat_max };
  const many = res.r_bands.length > 1;
  return [
    ...res.r_bands.map((b, i) => ({
      name: `${out.base} R band${many ? ` (${b.spin ?? `channel ${i + 1}`})` : ""}`,
      placement: out.placement,
      data: {
        time: b.q,
        values: b.q.map((_, k) => [b.r[k], nan(b.median[k]), nan(b.lo95[k]), nan(b.hi95[k]), nan(b.lo68[k]), nan(b.hi68[k])]),
        labels: [...R_BAND_LABELS],
        units: R_BAND_LABELS.map(() => ""),
        metadata: out.metadata({ spin: b.spin, channel: i + 1, band }),
      },
    })),
    ...res.sld_bands.map((b) => ({
      name: `${out.base} SLD band${b.spin ? ` (${b.spin})` : ""}`,
      placement: out.placement,
      data: {
        time: b.z,
        values: b.z.map((_, k) => [nan(b.median[k]), nan(b.lo95[k]), nan(b.hi95[k]), nan(b.lo68[k]), nan(b.hi68[k])]),
        labels: [...SLD_BAND_LABELS],
        units: SLD_BAND_LABELS.map(() => "Å⁻²"),
        metadata: out.metadata({ spin: b.spin, band }),
      },
    })),
  ];
}
