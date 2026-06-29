// Error-bar role (W5 column roles): pair a plotted y-channel with another channel
// that holds its ± uncertainty, and render vertical whiskers. The error values
// are just another channel of the same dataset, read client-side and aligned by
// row — no backend involvement. This module is the pure, testable core; the
// canvas drawing lives in uplotOverlays.errorBarsPlugin.

import type { DataStruct } from "./types";

/** Per-display-column error magnitudes, keyed by the uPlot data-column index
 *  (1-based: column 0 is x, column p+1 is the p-th plotted series). `errKeys`
 *  maps a value-channel index to the channel holding its ± error; channels
 *  without a mapping get no bars. Magnitudes are abs()'d; non-finite → null. */
export function buildErrorColumns(
  ds: DataStruct,
  plotted: number[],
  errKeys: Record<number, number>,
): Map<number, (number | null)[]> {
  const out = new Map<number, (number | null)[]>();
  plotted.forEach((ch, p) => {
    const errCh = errKeys[ch];
    if (errCh == null) return;
    const col = ds.values.map((row) => {
      const e = row[errCh];
      return Number.isFinite(e) ? Math.abs(e) : null;
    });
    out.set(p + 1, col);
  });
  return out;
}
