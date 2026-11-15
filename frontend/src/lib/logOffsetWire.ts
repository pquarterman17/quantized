// Export-only half of log offsets. The on-screen scaling remains in
// logOffset.ts; figure export is lazy and should not make its wire builder a
// startup cost.

import { logOffsetDecades, logOffsetsApply } from "./logOffset";
import { overlayModesMatchTheCanvas, type CycleView } from "./seriesStyleCycle";
import type { SeriesStyle } from "./types";

/** THE export's "do decade offsets apply?" -- asked by `logOffsetWire` for the
 *  base series and by `figureSpecOverlays` for the analysis overlays, with the
 *  SAME view the spec was built from and the spec's resolved `group_col`, so a
 *  curve and its fit are never offset by two different answers. */
export function exportLogOffsetsApply(view: CycleView & { waterfall: number }, groupCol: number | null): boolean {
  return logOffsetsApply(view.waterfall, groupCol) && overlayModesMatchTheCanvas({ ...view, groupKey: groupCol });
}

/** One entry per plotted channel, or no wire field when offsets do not apply. */
export function logOffsetWire(args: {
  plotted: readonly number[];
  seriesStyles: Record<number, SeriesStyle>;
  waterfall: number;
  view: CycleView;
  groupCol: number | null;
}): { log_offsets?: number[] } {
  if (!exportLogOffsetsApply({ ...args.view, waterfall: args.waterfall }, args.groupCol)) return {};
  const ks = args.plotted.map((ch) => logOffsetDecades(args.seriesStyles[ch]?.logOffset));
  return ks.some((k) => k !== 0) ? { log_offsets: ks } : {};
}
