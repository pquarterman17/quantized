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
import { copyText, payloadToTSV } from "./clipboard";
import type { PlotPayload } from "./plotdata";

const frame = (): Promise<void> => new Promise((done) => setTimeout(done, 16));
const thinned = (): { fit: boolean; baseline: boolean } => {
  const s = useApp.getState();
  return { fit: Boolean(s.fitOverlay?.full), baseline: Boolean(s.baselineOverlay?.lean) };
};

/** Does the column hold the `undefined` filler of a display curve? (A real
 *  gap is null / NaN, never undefined.) */
const hasFiller = (col: ArrayLike<number | null | undefined>): boolean => {
  for (let i = 0; i < col.length; i++) if (col[i] === undefined) return true;
  return false;
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
    const st = useApp.getState();
    const [fit0, baseline0] = [st.fitOverlay, st.baselineOverlay];
    let blocked = false;
    try {
      blocked = (await upgradeOverlaysForExport()) !== null;
    } catch {
      blocked = true;
    }
    // A swapped slot makes the canvas republish the payload (bounded wait);
    // nothing swapped means nothing to wait for.
    const now = useApp.getState();
    const swapped = now.fitOverlay !== fit0 || now.baselineOverlay !== baseline0;
    for (let i = 0; i < 60 && swapped && !blocked && latest() === initial; i++) await frame();
    payload = latest() ?? initial;
  }
  // Decided from the columns about to be copied, not from the store or from
  // whether the canvas republished in time: a display column still holds its filler.
  const drop = payload.series.flatMap((s, k) =>
    ((before.fit && s.fit) || (before.baseline && s.overlay && s.label === "baseline")) && hasFiller(payload.data[k + 1] as ArrayLike<number | null | undefined>)
      ? [k]
      : []);
  if (!drop.length) return { tsv: payloadToTSV(payload), omitted: [] };
  const keep = (_: unknown, i: number) => i === 0 || !drop.includes(i - 1);
  const narrowed = {
    ...payload,
    data: payload.data.filter(keep) as PlotPayload["data"],
    series: payload.series.filter((_, k) => !drop.includes(k)),
  };
  return { tsv: payloadToTSV(narrowed), omitted: drop.map((k) => payload.series[k].label) };
}

/** Copy the plot's data as TSV and say what happened in the status line. */
export async function copyPlotData(payload: PlotPayload, latest: () => PlotPayload | null): Promise<void> {
  const setStatus = useApp.getState().setStatus;
  try {
    const { tsv, omitted } = await plotDataTSV(payload, latest);
    const ok = await copyText(tsv);
    const nRows = payload.data[0]?.length ?? 0;
    const cols = payload.series.length + 1 - omitted.length; // + the x column
    const note = omitted.length ? `; left out ${omitted.join(", ")} (only its display curve was available)` : "";
    setStatus(ok ? `copied ${nRows}×${cols} to clipboard${note}` : "clipboard unavailable");
  } catch (e) {
    setStatus(`copy data failed: ${e instanceof Error ? e.message : "error"}`, "danger");
  }
}
