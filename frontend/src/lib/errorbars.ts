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

/** Default error-bar pairings for an Origin-imported dataset, derived from the
 *  worksheet column designations (`column_designations` + `origin_column_names`
 *  in metadata). Follows Origin's own rule: a "Y-error" column is the ± error of
 *  the nearest *preceding* "Y" column (verified across the reflectometry corpus —
 *  e.g. `R++`→`dR++`, `SA`→`dSA`). Returns a value-channel-index → error-channel-
 *  index map (both indexing `ds.values`), ready to drop into the store's
 *  `errKeys`. Empty for non-Origin data (no designations) or books with no
 *  Y-error columns. "X-error" columns are ignored — the plugin draws vertical
 *  whiskers only, and a leading `dQ` is genuinely the X's error, not a Y's. */
export function originErrKeys(ds: DataStruct): Record<number, number> {
  const meta = ds.metadata ?? {};
  const desig = meta["column_designations"];
  const names = meta["origin_column_names"];
  if (typeof desig !== "object" || desig === null || !Array.isArray(names)) return {};
  const byName = desig as Record<string, unknown>;
  const out: Record<number, number> = {};
  let lastY: number | null = null;
  for (let i = 0; i < names.length; i++) {
    const g = byName[String(names[i])];
    if (g === "Y") lastY = i;
    else if (g === "Y-error" && lastY !== null) out[lastY] = i;
  }
  return out;
}
