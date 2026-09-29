// The PERSISTED, eager half of the P1.4 encodings (PRIMARY_SOFTWARE_AUDIT_PLAN
// P1.4, "Any suitable factor can drive Group, Facet, Legend, Color, Symbol, or
// X"): a plot window's Color-by / Symbol-by / legend-label source as it rides
// its canonical document (`FigureBindings.encoding`, lib/figureDocument.ts),
// the ONE gate that decides which of those picks a render honours, and the
// resolved palette the export sends. The series DERIVATION stays in the lazy
// `lib/plotEncoding.ts`; this module is what the eager export spec builder and
// the Stage's gate need, kept small so it can sit there (the document codec
// needs only the dependency-free `./figureEncoding`).
//
// Channel indices, like every other binding (`groupKey`, `facetKey`): the
// document's `bindings.datasetId` owns the dataset they index. Stored RAW —
// the gate runs at render/export time, so a colour pick that stops reading
// categorical (a `channelTypes` override) is IGNORED rather than silently
// re-interpreted, and honoured again if the override is removed.

import type { FigureEncodingSpec } from "./api/figures";
import { resolveToHex } from "./color";
import type { FigureEncoding } from "./figureEncoding";
import { channelModelingType, isCategorical } from "./modeling";
import { AUTO_MARKER_CYCLE, SERIES_VARS, cssVar, seriesColor } from "./seriesStyleCycle";
import type { Dataset } from "./types";

// The picks' shape and validator live in the dependency-free ./figureEncoding
// (the eager document codec imports them); re-exported here for callers.
export { sanitizeFigureEncoding, type FigureEncoding } from "./figureEncoding";

/** The resolved encoding factors (value-channel indices), after gating. */
export interface Encoding {
  group: number | null;
  color: number | null;
  symbol: number | null;
  label: number | null;
}

/** What the gate reads: the data plus the per-channel type overrides. A frozen
 *  document's snapshot has no overrides, so `{ data }` alone is enough. */
export type EncodingSource = Pick<Dataset, "data" | "channelTypes">;

/** Can `channel` drive Color-by / Symbol-by on `ds`? A value channel that the
 *  modeling chokepoint reads as categorical (nominal or ordinal). */
export function isEncodingFactor(ds: EncodingSource, channel: number): boolean {
  return (
    channel >= 0 && channel < ds.data.labels.length && isCategorical(channelModelingType(ds as Dataset, channel))
  );
}

/** THE gate: `picks` against `ds`, with `group` the render's own group channel.
 *  Colour and symbol survive only as encoding factors; the label source takes
 *  any in-range channel. Null when no colour / symbol / label survives — the
 *  ordinary render path. */
export function resolveFigureEncoding(
  picks: FigureEncoding | null | undefined,
  ds: EncodingSource,
  group: number | null,
): Encoding | null {
  if (!picks) return null;
  const own = (c: number | null | undefined): number | null =>
    c !== null && c !== undefined && c >= 0 && c < ds.data.labels.length ? c : null;
  const factor = (c: number | undefined): number | null => {
    const k = own(c);
    return k !== null && isEncodingFactor(ds, k) ? k : null;
  };
  const enc = { group: own(group), color: factor(picks.color), symbol: factor(picks.symbol), label: own(picks.label) };
  return enc.color === null && enc.symbol === null && enc.label === null ? null : enc;
}

/** The encoding a plot WINDOW renders: `resolveFigureEncoding`, except that a
 *  bound secondary Y axis turns it off entirely — the same degrade
 *  `plotGroupSplit.canvasGroupCol` applies to Group, and for the same reason:
 *  every encoded series is drawn on the primary axis (the export route refuses
 *  `y2_keys` with an encoding). `groupCol` is the render's already-degraded
 *  group channel. Shared by the Stage (`Stage/usePlotEncoding`) and the
 *  document export (`figureSpec.buildFigureSpecForView`), so the two cannot
 *  disagree about whether a window is encoded. */
export function windowEncoding(
  picks: FigureEncoding | null | undefined,
  ds: EncodingSource,
  groupCol: number | null,
  y2Keys: readonly number[] | null | undefined,
): Encoding | null {
  return y2Keys && y2Keys.length > 0 ? null : resolveFigureEncoding(picks, ds, groupCol);
}

/** Does this encoding split the series (a group, colour or symbol factor)? A
 *  legend-source-only encoding keeps one series per Y channel. */
export function encodingSplits(enc: Encoding): boolean {
  return enc.group !== null || enc.color !== null || enc.symbol !== null;
}

/** The `/api/export/figure` `encoding` field for a resolved encoding — the
 *  factors (the group rides `group_col`, as ever), the palette the canvas
 *  resolves and, for a symbol factor, the glyph cycle. The one builder both the
 *  Graph Builder's export (`plotEncodingExport`) and a plot window's own export
 *  (`figureSpec.buildFigureSpecForView`) send. */
export function figureEncodingWire(enc: Encoding): FigureEncodingSpec {
  const palette = resolvedPalette();
  return {
    ...(enc.color === null ? {} : { color_col: enc.color }),
    ...(enc.symbol === null ? {} : { symbol_col: enc.symbol }),
    ...(enc.label === null ? {} : { label_col: enc.label }),
    ...(palette ? { palette } : {}),
    ...(enc.symbol === null ? {} : { markers: [...AUTO_MARKER_CYCLE] }),
  };
}

/** The colour cycle exactly as the canvas resolves it — each palette token
 *  through `seriesColor` (the canvas' own call), then to hex because matplotlib
 *  cannot read a CSS token. null when any token is undefined (no theme loaded;
 *  checked explicitly, because an unknown colour string "resolves" to the
 *  canvas' previous fill): the request then carries no palette rather than a
 *  partial or fabricated one. */
export function resolvedPalette(): string[] | null {
  const hex = SERIES_VARS.map((token) => (cssVar(token) ? resolveToHex(seriesColor(0, { color: token })) : null));
  return hex.every((h): h is string => h !== null) ? hex : null;
}
