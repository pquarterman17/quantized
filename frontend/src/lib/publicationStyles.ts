/** Publication wire styles plus their persistence sanitizer. Kept separate from
 * `lib/exportStyles.ts` so FigureDocument persistence never pulls the export's
 * COLOUR RESOLUTION — `color.resolveToHex` and the palette lookup — into the
 * store's import graph.
 *
 * Stated that precisely on purpose: this file's claim used to be the broader
 * "never pulls screen colour code in", and the import below makes that false.
 * `MARKER_SHAPE_VALUES` lives in `lib/seriesStyleCycle.ts`, which also holds
 * `cssVar`/`SERIES_VARS`/`seriesColor`, so persistence does reach a module with
 * colour in it. It is imported anyway rather than restated because the set is
 * DERIVED from the marker cycle and the two sanitizers (this one for the wire
 * style, `plotspec2.ts` for the view style) must not drift about which glyphs
 * exist — and splitting that module in two to make the old wording true would
 * buy a comment with eager bytes. The separation that carries weight is the one
 * from `exportStyles`, and it holds.
 *
 * BUG-016 round 4 widens that import by one leaf: `color.resolveToHex`. The
 * PRE-PROVENANCE migration rule (see `sanitizeExportSeriesStyles` below) is a
 * palette comparison, and it now runs HERE, once, at load — so the colour
 * resolution this header used to disclaim is genuinely on the persistence
 * path. `lib/color.ts` is a 37-line leaf with no imports of its own, and the
 * palette lookup (`seriesColor`) was already reachable through the import
 * above; what stays out of this graph is `exportStyles` itself, with the
 * export builders and the wire boundary. */
import { resolveToHex } from "./color";
import { MARKER_SHAPE_VALUES, seriesColor } from "./seriesStyleCycle";

export interface ExportSeriesStyle {
  color?: string;
  width?: number;
  /** `none` is the publication-renderer representation of point-only scatter. */
  line?: "solid" | "dashed" | "dotted" | "none";
  marker?: boolean;
  marker_size?: number;
  /** The wire form of `SeriesStyle.markerShape`, mapped to a matplotlib marker
   *  code by `calc.figure._MARKER`. Before this existed the backend hardcoded
   *  `"o"`, so all eight on-screen shapes exported as filled circles while the
   *  canvas drew them correctly (`uplotOpts.ts`'s `markerPaths`). An
   *  unrecognized value falls back to a circle rather than raising, matching
   *  `line`/`step`'s existing degrade-gracefully contract. */
  marker_shape?: string;
  /** `vs` and `color_by` remain dataset channel indices on the wire. */
  fill?: "under" | { vs: number };
  color_by?: number;
  colormap?: string;
  /** Stepped-line alignment (GAP_PLOTTYPES Graph Builder "step" mark) —
   *  the wire form of `SeriesStyle.step`/`StepMode`; mapped to matplotlib's
   *  `drawstyle` by `calc.figure._plot_kwargs`. */
  step?: "pre" | "post" | "mid";
  /** BUG-014: this series' legend text, used VERBATIM by the renderer
   *  (`calc.figure_labels.series_display_name`) — unit included or not,
   *  exactly as the user typed it, which is the on-screen rule
   *  (`uplotOpts`'s `args.seriesLabels?.[i] ?? "label (unit)"`). Absent = the
   *  renderer derives "label (unit)" from the DATA's own label and unit, which
   *  is every series of every request that predates BUG-014.
   *
   *  DERIVED AT EXPORT TIME, never persisted: `lib/figureSpecSeries.ts`'s
   *  `withSeriesLegends` lays it over whichever style list a request carries,
   *  reading `view.seriesLabels` — which is where a rename actually lives in a
   *  saved document. `sanitizeExportSeriesStyles` below deliberately DROPS it
   *  for that reason: a legend restored from a stale `publication.seriesStyles`
   *  could otherwise outvote the rename the user can still see and edit. */
  legend?: string;
  /** PROVENANCE for `color`, and the ONE key here that is not a wire field
   *  (BUG-016 round 3). `true` = `color` is the PALETTE slot `seriesColor`
   *  produced for this series' display position, a colour the user never
   *  chose; `false` = the user chose it (a swatch pick or a literal).
   *
   *  Absent = an array that has been through neither a producer nor a load.
   *  Round 4 made that unreachable from persistence: a PRE-PROVENANCE entry —
   *  one pinned by a build predating this key — is migrated by
   *  `sanitizeExportSeriesStyles` below, at load, so every array the app holds
   *  carries the flag. `toWireSeriesStyles` therefore treats a still-absent
   *  flag as UNVOUCHED and, on a grouped request only, omits the colour: an
   *  unvouched colour sent to a grouped export paints every level one hue
   *  (round 1's regression), while omitting it falls back to matplotlib's own
   *  cycle, which is what the pre-BUG-016 export did.
   *
   *  It exists because a pinned array outlives the state it was resolved
   *  against. Round 2 recovered "derived vs chosen" by re-resolving the live
   *  palette at export time, which is wrong the moment the theme, the palette
   *  preset or the request's display positions move since the pin — and then
   *  a grouped export ships the channel's one hue to every LEVEL, which is
   *  the regression BUG-016 round 1 created. Recording the answer at the
   *  producer (`exportStyles.buildExportStyles`) makes it independent of all
   *  three.
   *
   *  CAMEL-CASED on purpose: every other key here is the snake_case wire
   *  spelling, so this one reads as what it is — document-only. It is removed
   *  at the single wire boundary, `exportStyles.toWireSeriesStyles`, which
   *  every producer of a request's `series_styles` runs its array through --
   *  `figureSpecSeries.ts`, `figurebuilder/legacyFigure.ts` and
   *  `spatialPageExport.ts`. Each of the three has a test asserting no entry
   *  of the request it builds carries this key. */
  colorDerived?: boolean;
}

const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

/** The PRE-PROVENANCE migration predicate (BUG-016 round 4): does this pinned
 *  hex equal the palette slot for the index it was pinned at? Index order IS
 *  the order every producer of a pinned array built in (`legacyFigure`,
 *  `useGraphTemplates` and `plotSpecFigure` all pass `positions = null`), so
 *  this asks about the pin's own position.
 *
 *  An UNRESOLVABLE slot answers NO rather than guessing — `resolveToHex` needs
 *  a canvas for anything that is not already a 6-digit hex and returns null
 *  without one, so a real `oklch()` palette in a canvas-less environment would
 *  otherwise compare null-to-null and mark a 3-digit pinned colour the user
 *  chose as derived (this sanitizer accepts `#abc`). "Chosen" is the safe side
 *  of that: it loses per-level cycling on one legacy document, where the other
 *  side loses a colour outright. */
function isPaletteSlot(color: string, index: number): boolean {
  const slot = resolveToHex(seriesColor(index));
  if (slot === null) return false;
  return resolveToHex(color) === slot;
}

/** Safely restore exact publication-series wire styles from persisted input.
 *
 *  This is also where a PRE-PROVENANCE array acquires its `colorDerived`
 *  provenance, once, at load (BUG-016 round 4) — see the flag's own doc above
 *  and `isPaletteSlot`. Every persistence path that can carry one runs through
 *  here: `figuredoc.migrateConfig` for a `.dwk` FigureDoc's `config`,
 *  `figuredoc.loadGraphTemplates` for the saved graph-template store,
 *  `figureDocument` for a canonical document's `publication`, and
 *  `nameKeyedRecipes` for an imported template FILE. */
export function sanitizeExportSeriesStyles(value: unknown): (ExportSeriesStyle | null)[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) return null;
  return value.map((entry, index): ExportSeriesStyle | null => {
    if (entry === null) return null;
    const raw = object(entry);
    if (!raw) return null;
    const style: ExportSeriesStyle = {};
    if (typeof raw.color === "string") style.color = raw.color;
    // Restored only ALONGSIDE a colour (BUG-016 round 3): the flag describes
    // `color` and says nothing on its own, and letting a lone `colorDerived`
    // through would turn an otherwise empty entry into a non-null one below.
    //
    // ROUND 4: a MISSING or malformed flag beside a colour is MIGRATED here
    // rather than left absent. Round 3 left it absent and had the wire boundary
    // guess, once per request, off the palette live at export time; review F1
    // then measured that a reopened document re-persists its flagless array
    // verbatim (`legacyFigure` returns `docSeriesStyles` untouched), so the
    // "re-saving retires the residual" promise was false and the guess was
    // permanent. Deciding it HERE makes that promise true — the array the
    // builder holds after a load already carries provenance, so the next save
    // writes it — and reduces the comparison to exactly one evaluation, at the
    // moment the document arrives, instead of one per export under whatever
    // palette happens to be installed then. A string/number/null flag is
    // treated as ABSENT and migrated by the same rule (review F3 measured
    // `colorDerived: "no"` reading as `true` and `null` as `false` on the
    // `.dwk` path, which never ran this sanitizer at all).
    if (style.color !== undefined) {
      style.colorDerived =
        typeof raw.colorDerived === "boolean"
          ? raw.colorDerived
          : isPaletteSlot(style.color, index);
    }
    if (typeof raw.width === "number" && Number.isFinite(raw.width) && raw.width >= 0) style.width = raw.width;
    if (raw.line === "solid" || raw.line === "dashed" || raw.line === "dotted" || raw.line === "none") style.line = raw.line;
    if (typeof raw.marker === "boolean") style.marker = raw.marker;
    // Restored alongside `marker`: without this a saved FigureDocument's exact
    // publication styles came back shape-less and every marker reverted to a
    // circle on re-export — the same parity break `marker_shape` was added to
    // close, one layer down (the sanitizer was missed when the field landed).
    // Value-checked like `line`/`step` two lines away, against the SAME set the
    // view-style sanitizer uses: a persisted junk shape must not reach the
    // backend's `_MARKER` table to be silently downgraded there.
    if (typeof raw.marker_shape === "string" && MARKER_SHAPE_VALUES.has(raw.marker_shape)) {
      style.marker_shape = raw.marker_shape;
    }
    if (typeof raw.marker_size === "number" && Number.isFinite(raw.marker_size) && raw.marker_size >= 0) style.marker_size = raw.marker_size;
    if (raw.fill === "under") style.fill = raw.fill;
    else {
      const fill = object(raw.fill);
      if (fill && Number.isInteger(fill.vs) && (fill.vs as number) >= 0) style.fill = { vs: fill.vs as number };
    }
    if (Number.isInteger(raw.color_by) && (raw.color_by as number) >= 0) style.color_by = raw.color_by as number;
    if (typeof raw.colormap === "string") style.colormap = raw.colormap;
    if (raw.step === "pre" || raw.step === "post" || raw.step === "mid") style.step = raw.step;
    // `legend` is NOT restored -- see its own doc on ExportSeriesStyle above:
    // a rename persists in `view.seriesLabels` and is re-laid on every export.
    return Object.keys(style).length ? style : null;
  });
}
