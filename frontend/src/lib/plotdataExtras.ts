// Two plotdata helpers only lazy modules call, moved verbatim out of
// lib/plotdata.ts in bundle diet slice 24 so they ship with their callers
// instead of in the eager bundle: the Library thumbnail's channel pick
// (`primaryChannel`, also the Origin overlay's default y) and the peak
// workshops' marker column (`peakOverlayArray`). Import them by this path;
// plotdata.ts does not re-export them (architecture.test.ts, DRAGGED_OUT).
import { defaultDenseChannels } from "./plotdata";
import type { DataStruct } from "./types";

/** The single channel a one-line preview (the Library thumbnail) should draw:
 *  the first channel in the plot's own default dense set (see
 *  defaultDenseChannels), NOT a hardcoded "channel 0". Keeps the thumbnail
 *  showing the same real data the main plot draws by default even when
 *  channel 0 itself happens to be the NaN-sparse one. Returns null for a
 *  dataset with no channels at all. */
export function primaryChannel(ds: DataStruct): number | null {
  const dense = defaultDenseChannels(ds, null);
  return dense.length > 0 ? dense[0] : null;
}

/** Build a sparse y-column (null everywhere except the data point nearest each
 *  peak center, set to its height) so peaks render as markers on the shared x. */
export function peakOverlayArray(
  time: number[],
  peaks: { center: number; height: number }[],
): (number | null)[] {
  const y: (number | null)[] = new Array(time.length).fill(null);
  for (const p of peaks) {
    if (!Number.isFinite(p.center)) continue;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < time.length; i++) {
      const d = Math.abs(time[i] - p.center);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    y[best] = p.height;
  }
  return y;
}
