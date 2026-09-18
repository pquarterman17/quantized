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
 *  colour IS still sent: the canvas gives that one to every level too.
 *
 *  Which of the two a `color` came from is RECORDED on the entry as
 *  `colorDerived` (BUG-016 round 3) rather than inferred later, because an
 *  array that gets pinned into a document outlives the palette and the display
 *  positions it was resolved against. `toWireSeriesStyles` below reads that
 *  flag and removes it; nothing else should. */
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
    const chosen = Boolean(st?.color);
    const hex = grouped && !chosen ? null : resolveToHex(seriesColor(pos[i] ?? i, st));
    if (hex) {
      spec.color = hex;
      // BUG-016 round 3: record WHICH of the two `seriesColor` branches paid
      // for that hex, here, where the answer is known for certain. Everything
      // downstream -- a saved FigureDoc, a graph style template, a promoted
      // FigureDocument's `publication.seriesStyles` -- only ever sees the
      // resolved hex, and round 2 proved that hex cannot be classified after
      // the fact: the palette it was resolved against is gone the moment the
      // theme or the preset changes. Removed again at the wire boundary by
      // `toWireSeriesStyles`, so no request carries it.
      spec.colorDerived = !chosen;
    }
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
 * The ONE boundary between a stored style array and a request's
 * `series_styles` (BUG-016 round 3). Every producer of the wire field runs its
 * array through this: `figureSpecSeries.resolveSeriesPresentation` (the
 * canonical document path, both the derived and the PINNED branch),
 * `figurebuilder/legacyFigure.buildLegacyFigureSpec`, and
 * `spatialPageExport`. It does two things, and the first is why it exists.
 *
 * 1. A GROUPED request never sends a DERIVED colour. The backend expands each
 *    `y_keys`-aligned entry onto one synthetic series per LEVEL of the group
 *    column (`calc.figure_group_styles`), and the canvas colours those levels
 *    by their OWN display positions (`--series-1/2/3` for three levels,
 *    measured). One channel-aligned entry cannot say three colours, so sending
 *    the channel's slot paints every level that single hue — worse than the
 *    pre-BUG-016 export, which at least cycled. An EXPLICIT colour IS always
 *    sent: the canvas gives that one to every level too.
 *
 * 2. The provenance flag itself is removed, on every request, grouped or not.
 *    `ExportSeriesStyle.colorDerived` is a document field, not a wire field.
 *
 * WHY PROVENANCE AND NOT A COMPARISON (round 2's approach, retired here).
 * Round 2 classified a pinned colour by re-resolving `seriesColor` at export
 * time and calling the entry derived when the two hexes matched. Both inputs
 * to that comparison are the CURRENT state, not the pin's:
 *   - the palette. `--series-N` is redefined by every theme flip
 *     (`styles/colors.css`), by all five presets (`lib/palettes.ts`) and, for
 *     slot 1, by an accent switch. After any of those, every derived colour
 *     failed the equality, was read as "chosen", and shipped — the round-1
 *     one-hue regression, whole.
 *   - the position. The comparison was fed THIS request's display positions
 *     (`figureSpec.ts`'s BUG-015 canvas positions), while a pinned array is
 *     built in plain index order by every one of its producers. Measured
 *     divergences: `allowExplicitXAsY` (which
 *     `buildFigureSpecFromDocument` passes unconditionally) moves the doc's
 *     positions to `[1,0]`; hiding a channel after the pin shifts the rest.
 * Recording the answer at the producer removes both inputs from the question.
 *
 * PRE-PROVENANCE ARRAYS FAIL CLOSED HERE (round 5). An array whose entry
 * carries NO flag was pinned by a build that predates the key, and which of
 * the two its colour is cannot be recovered: the palette a pin was taken under
 * is persisted in no document. Round 3 guessed at this boundary (a palette
 * comparison, re-run per request under whatever theme was installed then) and
 * round 4 moved the same guess to LOAD, where a document opened under the
 * wrong theme was misclassified and the next save froze it. Neither guess had
 * the information. So an absent flag is UNVOUCHED, not "probably derived" and
 * not "probably chosen": on a GROUPED request its colour is omitted, because
 * sending an unvouched colour paints every level one hue (round 1's
 * regression, "worse than the bug") while omitting it falls back to
 * matplotlib's cycle, which is what the pre-BUG-016 export did. FLAT requests
 * are untouched either way, so a legacy figure exported flat still carries
 * every colour it always did.
 *
 * The residual that leaves — a pre-provenance document's CHOSEN colours do not
 * reach a GROUPED export — is retired by RE-PINNING the figure, which runs
 * `buildExportStyles` again and records the real answer. Loading and re-saving
 * do NOT retire it: the sanitizers deliberately add nothing
 * (`publicationStyles.sanitizeExportSeriesStyles`).
 *
 * Every OTHER array reaching this boundary was minted by a producer that
 * records provenance: `buildExportStyles` above (so the Figure Builder pin,
 * the Graph Builder handoff through `plotSpecFigure.stylesForMark`,
 * `useGraphTemplates.saveStyleTemplate`, `spatialPageExport` and
 * `figureSpecSeries`' derived branch all carry it) and
 * `originTemplate.sanitizeImportedTemplate`, whose decoded hexes are chosen by
 * construction.
 * See plans/BUGS_AND_ISSUES.md, BUG-016 round 5.
 *
 * Returns the caller's own array by reference when nothing changed.
 */
export function toWireSeriesStyles(
  styles: (ExportSeriesStyle | null)[],
  grouped: boolean,
): (ExportSeriesStyle | null)[] {
  let changed = false;
  const out = styles.map((style) => {
    if (!style) return style;
    const provenance = style.colorDerived;
    // `?? true` is the UNVOUCHED rule above — absent means the colour cannot
    // be vouched for, and a grouped request must not ship one it cannot. The
    // rule is deliberately the same for a flag that was never written and one
    // that was dropped as malformed: neither is the document's word.
    const dropColor = grouped && style.color !== undefined && (provenance ?? true);
    if (provenance === undefined && !dropColor) return style;
    changed = true;
    const rest: ExportSeriesStyle = { ...style };
    delete rest.colorDerived;
    if (dropColor) delete rest.color;
    // An emptied entry collapses to `null`, not `{}` — `buildExportStyles`'
    // own trailing rule, and the shape the backend reads as "no styling".
    return Object.keys(rest).length > 0 ? rest : null;
  });
  return changed ? out : styles;
}
