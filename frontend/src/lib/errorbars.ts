// Error-bar role (W5 column roles): pair a plotted y-channel with another channel
// that holds its ± uncertainty, and render vertical whiskers. The error values
// are just another channel of the same dataset, read client-side and aligned by
// row — no backend involvement. This module is the pure, testable core; the
// canvas drawing lives in uplotOverlays.errorBarsPlugin.

import { columnMetaList } from "./columnmeta";
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
/** Default error-bar pairings for a dataset: Origin Y-error designations
 *  ({@link originErrKeys}) merged with any parser-provided
 *  `metadata.error_channels` hint ({seriesCol: errCol} — e.g. reflectometry
 *  `.dat` pairs R with dR). The explicit hint wins on a conflict. Used to seed
 *  `errKeys` on dataset activation and to drive the Series-style error toggle. */
export function defaultErrKeys(ds: DataStruct): Record<number, number> {
  const out: Record<number, number> = { ...originErrKeys(ds) };
  const hint = (ds.metadata ?? {})["error_channels"];
  if (hint && typeof hint === "object" && !Array.isArray(hint)) {
    for (const [k, v] of Object.entries(hint as Record<string, unknown>)) {
      const ki = Number(k);
      const vi = Number(v);
      if (Number.isInteger(ki) && Number.isInteger(vi) && ki >= 0 && vi >= 0) out[ki] = vi;
    }
  }
  return out;
}

export function originErrKeys(ds: DataStruct): Record<number, number> {
  const list = columnMetaList(ds); // the shared alignment (lib/columnmeta) — never re-derived here
  const out: Record<number, number> = {};
  let lastY: number | null = null;
  for (let i = 0; i < list.length; i++) {
    const g = list[i]?.designation;
    if (g === "Y") lastY = i;
    else if (g === "Y-error" && lastY !== null) out[lastY] = i;
  }
  return out;
}

/** The value channels an Origin book would NOT draw as their own Y curve, to
 *  hide from the plot-all default so the imported plot matches Origin:
 *   - error columns ("Y-error"/"X-error") — a paired Y-error feeds its Y
 *     column's whiskers; an unpaired one (a leading `dQ`, or an X-error) is
 *     still an error, not data. Origin never plots an error as a separate series.
 *   - secondary X columns ("X") — a multi-XY book (e.g. a Moke file storing
 *     several hysteresis loops as X,Y,X,Y) keeps its FIRST X as the axis (the
 *     DataStruct `time`); any further X columns are axis columns, not data, and
 *     Origin draws them as the shared abscissa, never as a flat Y line.
 *  Hidden channels stay in the legend (toggleable) and still feed the whiskers
 *  via errKeys. Empty for non-Origin data (no designations). */
export function originHiddenChannels(ds: DataStruct): number[] {
  const list = columnMetaList(ds); // the shared alignment (lib/columnmeta) — never re-derived here
  const out: number[] = [];
  for (let i = 0; i < list.length; i++) {
    const g = list[i]?.designation;
    if (g === "Y-error" || g === "X-error" || g === "X") out.push(i);
  }
  return out;
}
