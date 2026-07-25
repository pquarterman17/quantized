// Error-bar role (W5 column roles): pair a plotted y-channel with another channel
// that holds its ± uncertainty, and render vertical whiskers. The error values
// are just another channel of the same dataset, read client-side and aligned by
// row — no backend involvement. This module is the pure, testable core; the
// canvas drawing lives in uplotOverlays.errorBarsPlugin.

import { columnMetaList } from "./columnmeta";
import { asymmetricPair, symmetricBinding, type ErrorBinding } from "./errorRoles";
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

// ── MAIN_PLAN #36: asymmetric and X error ──────────────────────────────────
// `buildErrorColumns` above carries ONE symmetric magnitude per point and draws
// vertically. That is the shape #33's role contract replaces, so this is the
// richer payload the plugin needs to honour what the instrument actually
// supplied: a separate up/down (or right/left) magnitude, per axis.

/** One error span for a display column: magnitudes in each direction. For a
 *  symmetric binding `plus` and `minus` are the same values. */
export interface ErrorSpan {
  axis: "x" | "y";
  /** Upward (y) or rightward (x) magnitude per point; null = no bar here. */
  plus: (number | null)[];
  /** Downward (y) or leftward (x) magnitude per point. */
  minus: (number | null)[];
}

function magnitudes(ds: DataStruct, channel: number, n: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    const v = ds.values[i]?.[channel];
    // abs(): a sign on an uncertainty column is a convention artefact, not a
    // direction — the SIDE is carried by the binding, not by the value.
    out.push(typeof v === "number" && Number.isFinite(v) ? Math.abs(v) : null);
  }
  return out;
}

/** Error spans per uPlot data-column index, from the canonical role bindings.
 *
 *  Keying matches `buildErrorColumns` (column 0 is x, column p+1 is the p-th
 *  plotted series) so the plugin indexes both the same way. A column can carry
 *  BOTH an x and a y span, which is why the value is a list.
 *
 *  X-error binds to the x axis (`target === -1`) and is emitted against every
 *  plotted column, since the x uncertainty applies to each point regardless of
 *  which series is drawn there. */
export function buildErrorSpans(
  ds: DataStruct,
  plotted: number[],
  bindings: readonly ErrorBinding[],
): Map<number, ErrorSpan[]> {
  const out = new Map<number, ErrorSpan[]>();
  const n = ds.time.length;
  const push = (col: number, span: ErrorSpan) => {
    const list = out.get(col);
    if (list) list.push(span);
    else out.set(col, [span]);
  };

  plotted.forEach((ch, p) => {
    const col = p + 1;
    for (const axis of ["y", "x"] as const) {
      // An asymmetric pair needs BOTH halves; half a pair would mean inventing
      // the other side, so it is skipped in favour of the symmetric binding.
      const target = axis === "x" ? -1 : ch;
      const pair = asymmetricPair(bindings, target, axis);
      if (pair) {
        push(col, {
          axis,
          plus: magnitudes(ds, pair.plus, n),
          minus: magnitudes(ds, pair.minus, n),
        });
        continue;
      }
      const sym = symmetricBinding(bindings, target, axis);
      if (sym != null) {
        const mag = magnitudes(ds, sym, n);
        push(col, { axis, plus: mag, minus: mag });
      }
    }
  });
  return out;
}
