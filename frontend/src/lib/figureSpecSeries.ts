// The per-series half of `lib/figureSpec.ts`: which channels a request draws,
// WHERE each of them sits in the canvas' palette/dash/waterfall index space,
// and the legend text each one carries.
//
// Split out of figureSpec.ts (BUG-014, which needed room under that module's
// 500-line ceiling) along a seam that was already cohesive: every export on
// this path has to answer the same three questions in the same order, and
// getting the SECOND one wrong is what BUG-015 was. Pure — view state and a
// DataStruct in, plain arrays out; no store, no transport.

import type { ErrorPair } from "./api";
import { buildErrorSpans } from "./errorbars";
import type { ErrorBinding } from "./errorRoles";
import { buildExportStyles, type ExportSeriesStyle } from "./exportStyles";
import { effectiveChannels } from "./plotdata";
import type { PlotView } from "./plotview";
import { overlayExportsSeriesStyles, type CycleView } from "./seriesStyleCycle";
import type { Dataset, DataStruct, SeriesStyle } from "./types";

/** The three display lists a figure request needs, resolved together. */
export interface DisplaySeries {
  /** The request's own display list: the y selection in `seriesOrder` order,
   *  hidden entries INCLUDED (the canvas keeps them with `show:false`). */
  displayChannels: number[];
  /** `displayChannels` minus the hidden ones — the wire's `y_keys`. */
  plotted: number[];
  /** Each entry of `plotted`'s slot in the CANVAS' display list — the index
   *  `uplotOpts.buildOpts` resolves that series' palette colour, dash/marker
   *  cycle and waterfall step against. */
  positions: number[];
}

export interface DisplaySeriesInput {
  yKeys: number[] | null;
  xKey: number | null;
  seriesOrder: number[] | null;
  hiddenChannels: number[];
  channelRoles?: Dataset["channelRoles"];
  /** Preserve the valid canonical case where an explicitly selected channel is
   *  deliberately used for both X and Y (`buildFigureSpecFromDocument` passes
   *  this unconditionally). The CANVAS never draws such a channel — see
   *  `positions` below for what that costs. */
  allowExplicitXAsY?: boolean;
}

/**
 * Resolve the display list, the plotted list, and each plotted series'
 * CANVAS display position.
 *
 * The positions are the whole point (BUG-015): `plotted` is hidden-FILTERED
 * while the canvas keeps a hidden series in place with `show:false`, so
 * colouring by the filtered index slides every later series down a palette
 * slot in the PDF but not on screen. They are NOT part of P3.3's opt-in
 * dash/marker cycle — `buildExportStyles` colours by them always.
 *
 * The canvas' list is `effectiveChannels(data, yKeys, xKey, …)` — the literal
 * call `usePlotPayload.fetchChannels` makes — which ALWAYS drops the x
 * channel. This request's own list may keep it (`allowExplicitXAsY`), so the
 * two index spaces can differ; that is exactly what
 * `seriesStyleCycle.displayListsAgree` refuses the cycle for. Positions are
 * therefore resolved against the CANVAS list, not this request's, so every
 * channel the canvas does draw lands on the slot the canvas painted it in. A
 * channel the canvas does NOT draw has no true slot at all, so it is parked
 * past the end of the canvas list (one fresh slot each) — any colour there is
 * a divergence, and a distinct one at least keeps two such curves apart
 * instead of collapsing them onto one paint.
 *
 * Slots are consumed from a per-channel QUEUE rather than looked up with
 * `indexOf`, so a `yKeys` carrying the same channel twice (the load
 * sanitizer does not dedupe: `figureDocument.integerList` filters non-integers
 * only) gives each occurrence its own slot, exactly as the canvas does
 * (`uplotOpts`'s `seriesColor(i, …)` is keyed by array index). It is also one
 * pass and O(n) rather than O(n²).
 */
export function resolveDisplaySeries(data: DataStruct, v: DisplaySeriesInput): DisplaySeries {
  const displayChannels = effectiveChannels(
    data,
    v.yKeys,
    v.allowExplicitXAsY && v.yKeys !== null ? null : v.xKey,
    v.channelRoles,
    v.seriesOrder,
  );
  const canvasChannels =
    v.allowExplicitXAsY && v.yKeys !== null
      ? effectiveChannels(data, v.yKeys, v.xKey, v.channelRoles, v.seriesOrder)
      : displayChannels;

  const queue = new Map<number, number[]>();
  canvasChannels.forEach((ch, i) => {
    const slots = queue.get(ch);
    if (slots) slots.push(i);
    else queue.set(ch, [i]);
  });

  const plotted: number[] = [];
  const positions: number[] = [];
  let parked = canvasChannels.length;
  for (const ch of displayChannels) {
    const slot = queue.get(ch)?.shift() ?? parked++;
    if (v.hiddenChannels.includes(ch)) continue;
    plotted.push(ch);
    positions.push(slot);
  }
  return { displayChannels, plotted, positions };
}

/** A request's answer to "does this view's canvas reproduce series-for-series?"
 *  — the `CycleView` the question is asked about, and the answer for THIS
 *  request. Both halves are returned because the view is asked twice: once for
 *  the P3.3 dash/marker cycle, once for BUG-013's waterfall offsets. */
export interface SeriesCycleDecision {
  view: CycleView;
  cycle: boolean;
}

/**
 * Resolve a request's P3.3 auto dash/marker cycle (`lib/seriesStyleCycle.ts`).
 *
 * OPT-IN, in two senses. `autoSeriesStyles` is passed by the LIVE stage export
 * (`figureSpec.buildStageFigureSpec`) and by nothing else — a saved document, a
 * Figure Page panel, a Figure Builder preview and a graph template all render
 * uncycled, which is what keeps a persisted `publication.seriesStyles` array the
 * user's RAW styles and makes a document authored with the preference on reopen
 * identically with it off. And `overlayExportsSeriesStyles` refuses the views
 * this route cannot style series-by-series anyway (`group_col` and `facets` are
 * documented as ignoring `series_styles` in `routes/export_figures.py`;
 * `stackMode` is the screen-only panel split that this single-figure request
 * does not reproduce) — the SAME predicate `PlotStage.tsx` gates its canvas on,
 * so the two cannot disagree about which views cycle. Positions come from the
 * UNFILTERED display list so a hidden series does not shift every later
 * channel's dash (and colour) by one. (No separate `facets === undefined`
 * clause: `facets` is non-undefined only when `st.facetKey` is set, which the
 * predicate already refuses. A clause no sabotage can make fail is dead code,
 * not defence in depth.)
 *
 * ONE more refusal rides the SAME predicate, and it is about the display list
 * rather than the view: `seriesStyleCycle.displayListsAgree` (folded into
 * `overlayExportsSeriesStyles`) refuses an X channel that is also in `yKeys`,
 * because `allowExplicitXAsY` keeps it in `displayChannels` AS a Y series while
 * the canvas' own call (`usePlotPayload.fetchChannels`) always drops it. It
 * lived inside `figureSpec.ts` as a local `xAlsoPlotted` test, which is why it
 * was a divergence rather than a refusal: the canvases could not see it, so with
 * `xKey:1, yKeys:[1,2,3]` the screen drew channels 2 and 3 solid/dashed and the
 * PDF drew all three solid.
 *
 * The POSITIONS `resolveDisplaySeries` returns are not part of that opt-in and
 * never were (BUG-015): they are each surviving channel's slot in the CANVAS'
 * display list, and `buildExportStyles` colours by them ALWAYS. Deriving them
 * only when the cycle was on is what let a saved document — which never opts in
 * — recolour a figure the moment one series was hidden.
 *
 * `groupKey` is what actually rides the wire; `st.groupKey` is the view's own
 * binding, which the plain live entry point does NOT forward — a grouped view
 * exported through it already renders an ungrouped overlay while the screen
 * shows one series per level, so either being set is enough to refuse.
 */
export function resolveSeriesCycle(
  st: PlotView,
  groupKey: number | null | undefined,
  autoSeriesStyles: boolean | undefined,
): SeriesCycleDecision {
  const view: CycleView = {
    groupKey: groupKey ?? st.groupKey,
    facetKey: st.facetKey,
    stackMode: st.stackMode,
    polarMode: st.polarMode,
    statMode: st.statMode,
    xKey: st.xKey,
    yKeys: st.yKeys,
  };
  return { view, cycle: autoSeriesStyles === true && overlayExportsSeriesStyles(view) };
}

/**
 * Lay the user's legend renames over a request's per-series presentation
 * list (BUG-014).
 *
 * A rename is a PRESENTATION choice, not a data edit, so it rides its own
 * field on the object that already carries colour/width/dash/marker rather
 * than rewriting `dataset.labels[ch]` on the wire — which is what made the
 * backend append the channel's unit to it a second time ("Loop 1" exported as
 * "Loop 1 (au)") while the screen showed the rename alone.
 *
 * `legends` is aligned 1:1 with the request's `y_keys`; `undefined` means "no
 * rename", and an EMPTY rename is carried through verbatim, matching
 * `uplotOpts`' `args.seriesLabels?.[i] ?? …` (which only falls back on
 * null/undefined, so `""` blanks the on-screen label too).
 *
 * `styles` may be `null` (a document that explicitly omits `series_styles`) or
 * shorter than `legends` (one that pins a degenerate array, `[]` included).
 * A rename still has to reach the renderer in both cases, so the result is
 * grown to cover every legend rather than only the entries a style already
 * occupies. With no renames at all `styles` is returned untouched — including
 * `null`, so a request that omits the field keeps omitting it and the wire is
 * byte-identical to before this existed.
 */
export function withSeriesLegends(
  styles: (ExportSeriesStyle | null)[] | null,
  legends: readonly (string | undefined)[],
): (ExportSeriesStyle | null)[] | null {
  if (!legends.some((legend) => legend !== undefined)) return styles;
  const out: (ExportSeriesStyle | null)[] = [];
  for (let i = 0; i < Math.max(styles?.length ?? 0, legends.length); i++) {
    const style = styles?.[i] ?? null;
    const legend = legends[i];
    out.push(legend === undefined ? style : { ...(style ?? {}), legend });
  }
  return out;
}

/**
 * The finished legend text for ONE series, by the BUG-014 product rule: a
 * rename is used VERBATIM (unit included or not, exactly as typed), and only
 * an un-renamed channel gets the derived `"label (unit)"` composition.
 *
 * This is the SAME resolution three other places already spell out —
 * `uplotOpts.buildOpts` (`args.seriesLabels?.[i] ?? (unit ? ... : label)`),
 * the backend's `calc.figure_labels.series_display_name`, and the flat
 * export path's `withSeriesLegends` + `series_styles[i].legend` pair. The
 * flat wire can defer the composition to the renderer because it ships the
 * data labels and the override separately; a FACET panel cannot — it ships
 * FINISHED strings (`FigureFacetSeries.label`) that no per-series field on
 * the request can reach — so it has to compose here, and it must compose the
 * same way or a renamed facet panel exports "Loop 1 (au)" while the screen
 * reads "Loop 1" (BUG-014's own symptom, which survived in the facet branch
 * until this existed).
 *
 * An EMPTY rename is honoured verbatim, matching `??` on the screen side.
 */
export function seriesDisplayLabel(label: string, unit: string, legend: string | undefined): string {
  if (legend !== undefined) return legend;
  return unit ? `${label} (${unit})` : label;
}

/** The request's whole `series_styles` field, in the one order the wire wants:
 *  styles first (so a legend never displaces one), renames laid over them.
 *
 *  `publication` is a canonical document's saved publication styles:
 *  `undefined` derives them from the view, `null` omits styles entirely, and
 *  an array is sent verbatim (deep-copied — the document must not observe the
 *  legend overlay). `null` still yields a list when something WAS renamed: see
 *  `withSeriesLegends`. */
export function resolveSeriesPresentation(
  plotted: number[],
  seriesStyles: Record<number, SeriesStyle>,
  positions: readonly number[],
  cycle: boolean,
  legends: readonly (string | undefined)[],
  publication: (ExportSeriesStyle | null)[] | null | undefined,
): (ExportSeriesStyle | null)[] | null {
  const base =
    publication === undefined
      ? buildExportStyles(plotted, seriesStyles, positions, cycle)
      : publication === null
        ? null
        : structuredClone(publication);
  return withSeriesLegends(base, legends);
}

/** Project the canvas error spans onto the export wire shape.
 *
 *  `buildErrorSpans` keys by uPlot COLUMN (0 = x, p+1 = the p-th series); the
 *  renderer wants one entry per plotted SERIES, so this re-indexes rather than
 *  letting the two conventions meet in the route — where the off-by-one would
 *  show up as error bars on the wrong curve. */
export function exportErrorSpans(
  data: DataStruct,
  plotted: number[],
  roles: readonly ErrorBinding[],
): ({ x?: ErrorPair; y?: ErrorPair } | null)[] {
  const byCol = buildErrorSpans(data, plotted, roles);
  return plotted.map((_ch, p) => {
    const spans = byCol.get(p + 1);
    if (!spans?.length) return null;
    const out: { x?: ErrorPair; y?: ErrorPair } = {};
    for (const s of spans) out[s.axis] = { plus: s.plus, minus: s.minus };
    return out;
  });
}
