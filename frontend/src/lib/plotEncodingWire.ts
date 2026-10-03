// The facet and export halves of the P1.4 encodings, moved verbatim out of
// lib/plotEncodingBinding.ts (bundle diet slice 22, plans/BUNDLE_HEADROOM.md):
// the facet grid's encoding and split, the `/api/export/figure` wire and the
// resolved palette it sends. Only lazy modules call them (the facet Stage,
// the series derivation, the export spec builders), so they load with those.
// Import them by path; lib/plotEncodingBinding.ts keeps the eager gate and
// does not re-export this module.

import type { FigureEncodingSpec } from "./api/figures";
import { resolveToHex } from "./color";
import type { Encoding } from "./plotEncodingBinding";
import { AUTO_MARKER_CYCLE, SERIES_VARS, cssVar, seriesColor } from "./seriesStyleCycle";

/** The encoding an xy FACET grid draws (P1.4 residual 3): a gradient colours
 *  single points of one series and is not drawn per panel, so it is dropped —
 *  null when nothing else is left. The Graph Builder says so in one sentence. */
export function facetEncoding(enc: Encoding | null): Encoding | null {
  if (!enc || enc.gradient === undefined) return enc;
  const rest: Encoding = { ...enc };
  delete rest.gradient;
  return rest.color === null && rest.symbol === null && rest.label === null ? null : rest;
}

/** The split an xy FACET grid draws: `facetEncoding(enc)`, or -- with no
 *  surviving encoding -- Group ALONE (`groupCol`, the render's already-degraded
 *  group channel) as a group-only encoding, so a grouped facet grid splits
 *  each panel's series by level exactly as the flat plot does
 *  (`lib/plotGroupSplit`: one series per (channel, level), named
 *  `"label (group=level)"`, each level in its channel's chosen colour else the
 *  panel's cycle). Null when nothing splits or names. Shared by the Stage
 *  (`Stage/useFacetEncoding`) and the export (`figureSpec.ts`), whose wire
 *  then carries the panel rows and channels for the route's own split
 *  (`calc/plotting_encoded_facets.py`) with `group_col`, and `encoding` only
 *  for a real encoding. */
export function facetSplitEncoding(enc: Encoding | null, groupCol: number | null): Encoding | null {
  const kept = facetEncoding(enc);
  if (kept) return kept;
  return groupCol === null ? null : { group: groupCol, color: null, symbol: null, label: null };
}

/** The `/api/export/figure` `encoding` field for a resolved encoding — the
 *  factors (the group rides `group_col`, as ever), the palette the canvas
 *  resolves, for a symbol factor the glyph cycle, a gradient's column and the
 *  picked text columns' names (appended by the backend as channels n, n+1, …).
 *  The one builder both the Graph Builder's export (`plotEncodingExport`) and a
 *  plot window's own export (`figureSpec.buildFigureSpecForView`) send. */
export function figureEncodingWire(enc: Encoding): FigureEncodingSpec {
  const palette = resolvedPalette();
  return {
    ...(enc.color === null ? {} : { color_col: enc.color }),
    ...(enc.symbol === null ? {} : { symbol_col: enc.symbol }),
    ...(enc.label === null ? {} : { label_col: enc.label }),
    ...(palette ? { palette } : {}),
    ...(enc.symbol === null ? {} : { markers: [...AUTO_MARKER_CYCLE] }),
    ...(enc.gradient === undefined ? {} : { gradient_col: enc.gradient }),
    ...(enc.text ? { text_columns: [...enc.text] } : {}),
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
