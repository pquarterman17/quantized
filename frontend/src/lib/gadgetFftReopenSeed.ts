// "Open in Gadget FFT" (OPEN_ITEMS row 12, reopen-seven lane): the recorded
// region and channel of a gadget FFT spectrum, read back strictly. FAIL CLOSED:
// null unless the region is two finite numbers and the channel is recorded
// completely. The window the backend reported (`window`) is informational only
// (the gadget has no window option), so it is not required. Lazy: imported by
// the opener (store/toolReopenChannels.ts, store/toolReopenOpen.ts) only.

import type { ReopenSeed } from "./committedOutputReopen";

export interface GadgetFftSeed {
  /** The ROI band, in the units of `xKey`'s column. */
  roi: [number, number];
  /** The curve's own X column (null = the time axis) and the signal column it ran on. */
  xKey: number | null;
  yKey: number;
}

export function gadgetFftSeed(s: ReopenSeed | null | undefined): GadgetFftSeed | null {
  if (!s) return null;
  const { roi, xKey, yKey } = s;
  if (!Array.isArray(roi) || roi.length !== 2) return null;
  const [lo, hi] = roi;
  if (typeof lo !== "number" || typeof hi !== "number" || !Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) return null;
  const index = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
  if (!(xKey === null || index(xKey)) || !index(yKey)) return null;
  return { roi: [lo, hi], xKey, yKey };
}
