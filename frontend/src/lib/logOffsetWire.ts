// Export-only half of log offsets. The on-screen scaling remains in
// logOffset.ts; figure export is lazy and should not make its wire builder a
// startup cost.

import { logOffsetDecades, logOffsetsApply } from "./logOffset";
import { overlayModesMatchTheCanvas, type CycleView } from "./seriesStyleCycle";
import type { SeriesStyle } from "./types";

/** One entry per plotted channel, or no wire field when offsets do not apply. */
export function logOffsetWire(args: {
  plotted: readonly number[];
  seriesStyles: Record<number, SeriesStyle>;
  waterfall: number;
  view: CycleView;
  groupCol: number | null;
}): { log_offsets?: number[] } {
  if (!logOffsetsApply(args.waterfall, args.groupCol)) return {};
  if (!overlayModesMatchTheCanvas({ ...args.view, groupKey: args.groupCol })) return {};
  const ks = args.plotted.map((ch) => logOffsetDecades(args.seriesStyles[ch]?.logOffset));
  return ks.some((k) => k !== 0) ? { log_offsets: ks } : {};
}
