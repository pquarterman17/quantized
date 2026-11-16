// Tauc plot payload (pure): the transformed edge as markers plus the fitted
// straight line, which is drawn from the extrapolated band gap (y = 0) up to
// the top of the fit window so the intercept is visible on the energy axis.

import type { PlotPayload } from "../../../lib/plotdata";
import type { TaucResult } from "../../../lib/api/analysisExtras";

export function taucPayload(r: TaucResult, yLabel: string): PlotPayload {
  const hi = r.fit_energy[1];
  const line = (x: number): number => r.slope * x + r.intercept;
  // One ascending x column carrying every data energy plus the intercept, so
  // the line reaches y = 0 even when no data point sits at Eg.
  const pts: [number, number | null, number | null][] = r.energy.map((e, i) => [
    e,
    r.tauc[i],
    e >= r.fit_energy[0] && e <= hi ? line(e) : null,
  ]);
  pts.push([r.eg, null, line(r.eg)]);
  pts.sort((a, b) => a[0] - b[0]);
  return {
    data: [pts.map((p) => p[0]), pts.map((p) => p[1]), pts.map((p) => p[2])] as PlotPayload["data"],
    series: [
      // `fit` gives the straight line the app's fit-curve look and draws the data with markers.
      { label: yLabel, unit: "" },
      { label: "linear fit", unit: "", overlay: true, fit: true },
    ],
    xLabel: "Photon energy",
    xUnit: "eV",
  };
}
