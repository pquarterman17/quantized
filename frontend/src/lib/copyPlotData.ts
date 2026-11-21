// "Copy data" (TSV) of the plot, with the fit and baseline at FULL resolution.
// LAZY (click-only): usePlotStageActions loads it on the click.
//
// A large Curve Fit and a large SNIP / ModPoly estimate draw a display curve /
// lean preview: real values at ~8k rows, `undefined` (blank in a TSV) between.
// Pasted into Origin or Excel that column would look like the fit and be
// mostly empty, so the slots are upgraded first (store/fitOverlayUpgrade), the
// canvas is given a moment to publish the full payload, and what still could
// not be upgraded is left out and said so.

import { upgradeOverlaysForExport } from "../store/fitOverlayUpgrade";
import { useApp } from "../store/useApp";
import { payloadToTSV } from "./clipboard";
import type { PlotPayload } from "./plotdata";

const frame = (): Promise<void> => new Promise((done) => setTimeout(done, 16));
const thinned = (): { fit: boolean; baseline: boolean } => {
  const s = useApp.getState();
  return { fit: Boolean(s.fitOverlay?.full), baseline: Boolean(s.baselineOverlay?.lean) };
};

/** The TSV of `initial` (`latest()` reads the payload on screen now), plus the
 *  labels of the columns left out because only their display form was
 *  available. */
export async function plotDataTSV(
  initial: PlotPayload,
  latest: () => PlotPayload | null,
): Promise<{ tsv: string; omitted: string[] }> {
  let payload = initial;
  const before = thinned();
  if (before.fit || before.baseline) {
    let blocked = false;
    try {
      blocked = (await upgradeOverlaysForExport()) !== null;
    } catch {
      blocked = true;
    }
    // The upgrade rewrites the slot; the canvas republishes the payload (bounded wait).
    for (let i = 0; i < 60 && !blocked && latest() === initial; i++) await frame();
    payload = latest() ?? initial;
  }
  const now = thinned();
  const drop = payload.series.flatMap((s, k) =>
    (now.fit && s.fit) || (now.baseline && s.overlay && s.label === "baseline") ? [k] : []);
  if (!drop.length) return { tsv: payloadToTSV(payload), omitted: [] };
  const keep = (_: unknown, i: number) => i === 0 || !drop.includes(i - 1);
  const narrowed = {
    ...payload,
    data: payload.data.filter(keep) as PlotPayload["data"],
    series: payload.series.filter((_, k) => !drop.includes(k)),
  };
  return { tsv: payloadToTSV(narrowed), omitted: drop.map((k) => payload.series[k].label) };
}
