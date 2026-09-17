// Build per-series style specs for the publication export, in plotted (display)
// order, so the matplotlib figure matches the on-screen uPlot styling. Colors are
// resolved to hex (matplotlib can't parse OKLCH tokens); width/line/marker come
// straight from the per-channel overrides. Aligns 1:1 with the route's y_keys.

import { resolveToHex } from "./color";
import type { ExportSeriesStyle } from "./publicationStyles";
import type { SeriesStyle } from "./types";
import { resolveSeriesStyle, seriesColor } from "./seriesStyleCycle";

export type { ExportSeriesStyle } from "./publicationStyles";

/** `plotted` = the channel indices being drawn (yKeys ?? all channels), in order.
 *  Returns one spec per series (null = no styling → matplotlib defaults).
 *
 *  `positions` is the CANVAS' display position for each entry of `plotted`;
 *  `null`/absent means "`plotted` IS the display order" (plain 0,1,2,…), which
 *  is true for every producer whose list is not hidden-filtered against a
 *  wider canvas list (`legacyFigure`, `useGraphTemplates`, `plotSpecFigure`,
 *  and the spatial page panel, whose cell canvas filters the same way it does).
 *  It matters because `lib/figureSpec.ts`'s `plotted` IS hidden-FILTERED while
 *  the canvas keeps hidden series in place with `show:false`: without the
 *  canvas' positions, hiding one series slides every later one down a palette
 *  slot in the PDF but not on screen (BUG-015). Positions are therefore NOT
 *  opt-in — this function colours by display position always.
 *
 *  `cycle` (P3.3, `lib/seriesStyleCycle.ts`) is the separate, opt-in half: the
 *  auto dash/marker cycle, which a producer turns on only when its live canvas
 *  is cycling the same series at the same positions. It rides the SAME
 *  positions, so screen and PDF cannot disagree about which slot a series is
 *  in; `false` (the default) is byte-identical to what this function did
 *  before the cycle existed.
 *
 *  `grouped` (BUG-016) says this request carries `group_col`, so the backend
 *  will expand every entry of this list onto one synthetic series PER LEVEL of
 *  the group column (`calc.figure_group_styles`). Every other key survives that
 *  expansion unchanged, because the canvas hands each level the SAME channel
 *  style object (`Stage/usePlotPayload.ts`'s `styleList` over
 *  `plotGroupSplit.groupSplitChannelMap`) -- but a PALETTE colour does not, and
 *  that is the whole reason for this flag. `seriesColor` returns an explicit
 *  `style.color` at every position and otherwise the palette slot at the
 *  series' OWN display position, and a grouped canvas' display positions are
 *  per-LEVEL: measured, a channel with no colour draws its three levels
 *  `--series-1`, `--series-2`, `--series-3`. One channel-aligned entry cannot
 *  say that, so a palette-derived colour is OMITTED rather than sent -- sending
 *  it would paint every level the channel's one slot, which is neither what the
 *  canvas draws nor what the pre-BUG-016 export did. With no `color` key
 *  matplotlib's own cycle colours the levels, exactly as before. An EXPLICIT
 *  colour IS still sent: the canvas gives that one to every level too. */
export function buildExportStyles(
  plotted: number[],
  seriesStyles: Record<number, SeriesStyle>,
  positions: readonly number[] | null = null,
  cycle = false,
  grouped = false,
): (ExportSeriesStyle | null)[] {
  const pos: readonly number[] = positions ?? plotted.map((_ch, i) => i);
  return plotted.map((ch, i) => {
    // The EFFECTIVE style — the stored per-channel style plus the P3.3 auto
    // dash/marker cycle when this producer opted in. This is the ONE reason the
    // export cannot diverge from the canvas: `uplotOpts.buildOpts` calls the
    // same `resolveSeriesStyle` against the same display-position list, so the
    // backend never learns that a cycle exists — it just receives an ordinary
    // explicit `line`/`marker_shape` and renders it (the faceted-styling
    // attempt that shipped a screen-only change is FEATURE-001 in
    // plans/BUGS_AND_ISSUES.md; this is the shape that avoids repeating it).
    const st = resolveSeriesStyle(seriesStyles[ch], i, cycle ? pos : null);
    const spec: ExportSeriesStyle = {};
    // `?? i` keeps a short/ragged `positions` degrading to the plotted index
    // instead of `seriesColor(undefined)` indexing SERIES_VARS[NaN] and
    // painting every such series the hardcoded fallback. Defensive only: the
    // one non-null producer builds it with `plotted.length` entries.
    // BUG-016: a grouped request sends only an EXPLICIT colour (see `grouped`
    // above) -- `seriesColor`'s palette fallback is position-derived and this
    // list's positions are channels, not the levels the renderer draws.
    const hex = grouped && !st?.color ? null : resolveToHex(seriesColor(pos[i] ?? i, st));
    if (hex) spec.color = hex;
    if (st?.width != null) spec.width = st.width;
    if (st?.line) spec.line = st.line;
    if (st?.marker) {
      spec.marker = true;
      if (st.markerSize != null) spec.marker_size = st.markerSize;
      // Without this the backend's marker-shape table is unreachable and every
      // exported marker is a filled circle, whatever shape the canvas drew
      // (`uplotOpts.ts` honours `markerShape`; `calc/figure.py` did not).
      // Emitted here rather than at a call site so every producer of export
      // styles gets it — spatialPageExport, legacyFigure, useGraphTemplates
      // and plotSpecFigure all route through this one builder.
      if (st.markerShape) spec.marker_shape = st.markerShape;
    }
    if (st?.fill && st.fill !== "none") spec.fill = st.fill;
    if (st?.step) spec.step = st.step;
    if (st?.colorBy != null) {
      spec.color_by = st.colorBy;
      spec.colormap = st.colormap ?? "viridis";
    }
    return Object.keys(spec).length > 0 ? spec : null;
  });
}

/**
 * Drop a PALETTE-DERIVED `color` from an ALREADY-BUILT publication style array
 * (BUG-016 round 2).
 *
 * `buildExportStyles`' `grouped` flag reaches only the DERIVED branch. A
 * document that pins `publication.seriesStyles` ships that array verbatim, and
 * such an array is itself this builder's output on a FLAT request — which
 * always bakes the channel's palette slot into `color`, a colour the user
 * never chose. Grouping such a document (reopening a `FigureDoc` saved before
 * BUG-016, or applying a graph style template, whose
 * `useGraphTemplates.saveStyleTemplate` builds the array flat by design so it
 * stays portable onto a flat figure) then sent that ONE hue to the backend,
 * which paints every level with it: measured `#7fb3ff`/`#ffb37f`/`#8fe08f` on
 * the canvas against `#7fb3ff`x3 in the export — the very divergence the
 * derived branch was changed to avoid, and a REGRESSION against the pre-fix
 * rendering (matplotlib's cycle, which at least cycled).
 *
 * The pinned array does not record whether a colour was explicit, so the truth
 * is recovered rather than trusted: an entry whose `color` resolves to exactly
 * the palette slot `seriesColor` would have produced at that entry's display
 * position IS the derived one and is stripped; anything else is a colour the
 * user chose and survives, because the canvas gives an explicit colour to
 * every level too. `positions` is the list the array was built against (`null`
 * = the builder's own index order, which is what every producer of a pinned
 * array passes).
 *
 * The AMBIGUITY is deliberate and one-sided. A user who hand-picks the exact
 * hex of the palette slot their series already sits in gets the cycling
 * render — which is what the canvas draws for that series anyway, so the two
 * still agree. Guessing the other way (calling it explicit and painting three
 * levels one hue) is the regression above.
 *
 * Returns the caller's own array by reference when nothing is derived, so a
 * request pinning explicit colours is unchanged by this existing.
 */
export function stripDerivedColors(
  styles: (ExportSeriesStyle | null)[],
  positions: readonly number[] | null = null,
): (ExportSeriesStyle | null)[] {
  let changed = false;
  const out = styles.map((style, i) => {
    if (!style?.color) return style;
    const slot = resolveToHex(seriesColor(positions?.[i] ?? i));
    // An UNRESOLVABLE slot (`resolveToHex` needs a canvas for anything that is
    // not already a 6-digit hex, and returns null without one) strips nothing
    // rather than guessing: the pinned array stays the document's word
    // wherever the derived value cannot be reconstructed.
    if (slot === null || resolveToHex(style.color) !== slot) return style;
    changed = true;
    const rest: ExportSeriesStyle = { ...style };
    delete rest.color;
    return Object.keys(rest).length > 0 ? rest : null;
  });
  return changed ? out : styles;
}
