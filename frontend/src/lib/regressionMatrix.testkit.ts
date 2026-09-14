// P4.2 canonical plot/project regression matrix — the CANONICAL STRUCTURAL
// PAYLOAD all three figure paths must agree on, plus the shared projection
// helpers. The three per-path extractors live in
// `regressionMatrixLegs.testkit.ts` (this file would otherwise sit over the
// 500-line .ts module ceiling); the fixtures live in
// `regressionMatrixFixtures.testkit.ts`.
//
// WHY THIS EXISTS (PRIMARY_SOFTWARE_AUDIT_PLAN P4.2). Three of this repo's
// silent regressions — FEATURE-001 (faceted styling diverging screen vs
// export), BUG-006 (sidecar misalignment), BUG-011 (a pack shipping preview
// rows) — are all instances of the SAME missing property: "the figure you see
// on screen, the figure the export wire describes, and the figure a reopened
// project reconstructs are structurally the same figure" was never asserted as
// a standing invariant. Every existing test pins ONE path
// (`figureSpec.a8.test.ts` pins the wire; `tests/test_export_vector_structure.py`
// pins the renderer; `workspace.test.ts` pins persistence). Nothing compared
// them to each other.
//
// The three paths, and what each extractor reads:
//
//   SCREEN  — `lib/plotdata.ts`'s `buildColumns` (the documented OFFLINE mirror
//             of `/api/plot/series` that `fetchPlot` falls back to) composed
//             exactly as `components/Stage/usePlotPayload.ts` composes it
//             (categorical x -> group split -> `composeDisplayPayload`), then
//             `lib/uplotOpts.ts`'s `buildOpts` — the REAL uPlot options object
//             the canvas is constructed from. Series styling, axis labels,
//             scales and limits are read back OUT of that options object, not
//             re-derived from the view.
//   EXPORT  — `lib/figureSpec.ts`'s `buildFigureSpecFromDocument`: the exact
//             `FigureSpec` posted to `/api/export/figure`. The same adapter
//             Stage copy/export, the Figure Builder and every page panel use.
//   REOPEN  — the document AND its dataset round-tripped through the REAL
//             project persistence boundary (`serializeWorkspace` ->
//             `parseWorkspace`), then projected from the reopened
//             FigureDocument's OWN fields (bindings + plot.view + publication).
//             Deliberately NOT by re-running the screen or export builder on
//             the reopened document — that would only prove the builders are
//             deterministic. This leg reads the persisted model directly, so a
//             field that survives the round trip in name but not in meaning
//             still fails.
//
// WHAT "STRUCTURAL" MEANS HERE: no pixels, no rendered bytes. The comparison is
// the series list (order, visibility, channel binding, x binding), per-series
// style, error bindings, grouping/facet/y2/x-break/waterfall settings, axis
// labels/limits/scales, and decorations — the fields P4.2 names.
//
// DELIBERATE LIMITS, each one a real property of the code and not a fudge:
//   * `series[].color` is the resolved CSS colour at the series' DISPLAY
//     POSITION on every leg. In jsdom the `--series-N` custom properties are
//     undefined, so `seriesColor` would return one shared fallback for every
//     position and the comparison would be vacuous — `installSeriesPalette()`
//     installs a distinct literal per position so a position skew is visible.
//     The colour EQUALITY is itself conditional: `lib/contrastColor.ts`'s
//     `resolveDrawColor` substitutes the ink token for any stroke below
//     MIN_CONTRAST (2.2) against the canvas background, and only the canvas
//     applies it — a series styled `#000000` draws `#eee` on screen and
//     exports `#000000`, correctly (the export canvas is white). Both
//     `TEST_SERIES_PALETTE` and `FIXTURE_COLORS` are therefore chosen LIGHT so
//     the substitution never fires and the two legs are comparing the same
//     quantity. That asymmetry is real and out of this matrix's scope; a
//     fixture using a dark colour would have to model it explicitly.
//   * GROUP mode: the backend expands `group_col` into one series per level
//     itself, so the export wire carries the BASE channels while the canvas
//     already carries the expanded ones. The screen leg therefore collapses its
//     display series back to first-occurrence-per-channel, and `styleComparable`
//     is FALSE for this mode — see its doc and BUG-016: the backend's
//     `group_col` branch drops `series_styles` outright, so comparing them
//     leg-to-leg compared a field the renderer never reads. Level identity
//     moves into `grouping`; the styling divergence is pinned by its own test.
//   * FACET mode: per-series styling is ignored by faceted plots on BOTH screen
//     and export (FEATURE-001, `plans/BUGS_AND_ISSUES.md`), so every leg reports
//     `null` styling for a faceted figure and the panel partition is compared
//     instead.
//   * Axis labels are compared as explicit strings. Every fixture sets them, so
//     the backend's own "derive `label (unit)` from the data" fallback (which
//     `lib/uplotOpts.ts` mirrors exactly — see `routes/export_figures.py`'s
//     `_resolve_figure`) is not what is under test here.
//
// KNOWN LIMITS OF THE LEG-VS-LEG EVIDENCE (recorded 2026-09-14 by review,
// deliberately NOT papered over — a doc-promise audit of "no leg calls
// another, so an equality between two legs is evidence about the product"):
//   * SHARED INPUT, not independent evidence, for two fields. `mode` is
//     `figureMode(document)` on all three legs, so it can never differ. The
//     FACET PARTITION is `facetPayloads(...)` on the screen and reopen legs and
//     `lib/figureSpecFacets.ts` maps that same primitive straight onto the
//     wire — measured: sabotaging `lib/facet.ts`'s panel label fails the golden
//     and the facet non-vacuity test but leaves `screen ≡ export` green. The
//     COMMITTED GOLDEN is what actually backstops those two fields; the
//     leg-to-leg equality is a consistency check on top of it.
//   * THE SCREEN LEG IS A MIRROR of `components/Stage/usePlotPayload.ts`'s
//     pipeline (`effectiveChannels` -> `buildColumns` -> `categoricalXPayload`
//     -> `applyGroupSplit` -> `composeDisplayPayload`), not the hook itself, so
//     "reorder the hook and the matrix still passes" is a real hole. It is a
//     mirror rather than a `renderHook(usePlotPayload)` call because the hook
//     delivers its payload through an ASYNC `fetchPlot` state transition (which
//     also applies `dropTrailingEmptyRows`, a step this mirror omits — a no-op
//     for every matrix fixture, none of which has trailing empty rows) and
//     `projectScreen` is a synchronous function called ~20 times across the
//     suite. Driving the real hook is the honest upgrade if this leg ever
//     disagrees with the canvas; until then the mirror's fidelity is asserted
//     by reading nothing back out of it — every compared value comes from the
//     real `buildOpts` options object it feeds.

import { groupLevelLabel, levelOrderFor } from "./categorical";
import { facetPayloads } from "./facet";
import type { ErrorSpan } from "./errorbars";
import type { FigureDocument } from "./figureDocument";
import type { PlotPayload } from "./plotdata";
import type { LegendPos, PlotView } from "./plotview";
import { DASH, SERIES_VARS } from "./seriesStyleCycle";
import type { AxisScale, DataStruct, LineStyle, SeriesStyle } from "./types";

// ── the canonical structural payload ────────────────────────────────────────

export interface CanonicalAxis {
  label: string | null;
  scale: AxisScale;
  limits: [number, number] | null;
}

/** One DRAWN series. A hidden series is absent from every leg's list: the
 *  canvas marks it `show:false` and the export wire omits it outright, so
 *  "is it drawn" is the only representation all three paths share. */
export interface CanonicalSeries {
  /** Dataset channel this series is bound to. */
  channel: number;
  /** Display text (an explicit rename, else `label (unit)`). */
  label: string;
  unit: string;
  /** 0 = primary Y, 1 = secondary Y. */
  axis: 0 | 1;
  /** Resolved CSS colour, or null where the mode makes it non-comparable. */
  color: string | null;
  width: number | null;
  /** Dash pattern (`lib/seriesStyleCycle.ts`'s DASH table); null = solid. */
  dash: number[] | null;
  marker: { shape: string; size: number } | null;
  step: string | null;
  fill: string | null;
}

export interface CanonicalError {
  axis: "x" | "y";
  plus: (number | null)[];
  minus: (number | null)[];
  symmetric: boolean;
}

export interface CanonicalDecor {
  legend: { show: boolean; position: LegendPos | null; title: string | null };
  annotations: { x: number; y: number; text: string }[];
  shapes: { kind: string; x1: number; y1: number; x2: number; y2: number }[];
  refLines: { axis: "x" | "y"; value: number }[];
  regionShades: { x1: number; x2: number; y1: number; y2: number; fill: string }[];
}

export interface CanonicalFigure {
  mode: "flat" | "group" | "facet";
  xBinding: number | null;
  series: CanonicalSeries[];
  /** One entry per `series` position; `[]` = that series carries no error. */
  errors: CanonicalError[][];
  grouping: { channel: number | null; levelOrder: number[] | null; levelLabels: string[] | null };
  facet: { channel: number | null; panels: { label: string; series: string[] }[] | null };
  /** Display positions drawn against the secondary Y axis. */
  y2Positions: number[];
  xBreaks: [number, number][];
  /** The vertical offset this path's rendered data actually carries for the
   *  SECOND display series (0 = none applied). See `measureWaterfall`. */
  waterfallOffset: number;
  axes: { x: CanonicalAxis; y: CanonicalAxis; y2: CanonicalAxis | null };
  decor: CanonicalDecor;
}

/** One canonical multi-panel page (the `panels` fixture). */
export interface CanonicalPage {
  rows: number;
  cols: number;
  /** Row-major slot placement. `figure` is the referenced figure's NAME
   *  (the one identity all three legs carry — the export wire's
   *  `PagePanelSpec.figure.filename` is the document name). */
  panels: { row: number; col: number; label: string | null; title: string | null; figure: string | null }[];
  /** The RESOLVED per-slot label the composer shows ("(a)", "(b)", …), from
   *  `lib/pageDocumentActions.ts`'s `pagePanelLabels`. */
  resolvedLabels: string[];
  layout: { linkX: boolean; linkY: boolean; rowGap: number | null; colGap: number | null; alignLabels: boolean; resizeMode: string };
}

// ── shared helpers ──────────────────────────────────────────────────────────

/** A distinct literal per palette slot. Deliberately all LIGHT: jsdom reports
 *  the dark theme (`uplotOpts`' `appThemeIsDark` treats an unset
 *  `data-theme` as dark), and `lib/contrastColor.ts`'s `resolveDrawColor`
 *  substitutes the ink token for any stroke that would be invisible there — a
 *  dark palette would collapse every screen-leg colour onto one value and make
 *  the comparison vacuous in exactly the way this palette exists to prevent.
 *
 *  DISJOINT from `regressionMatrixFixtures.testkit.ts`'s `FIXTURE_COLORS` (see
 *  its doc): an explicit `SeriesStyle.color` that happens to equal the palette
 *  slot it sits in proves nothing about the override being honoured. */
export const TEST_SERIES_PALETTE = [
  "#7fb3ff", "#ffb37f", "#8fe08f", "#d9a3ff",
  "#ffd27f", "#7fe0e0", "#ff9fd0", "#c9c9c9",
] as const;

/** Install a distinct literal colour per `--series-N` slot so the colour
 *  comparison is not vacuous in jsdom (see the header), and PIN the theme the
 *  contrast check reads. The theme is pinned rather than inherited because
 *  `appThemeIsDark` currently resolves an unset `data-theme` to dark: leaving
 *  it implicit would make these goldens depend on that default, and a change
 *  to it would silently substitute every colour instead of failing loudly.
 *  Returns a teardown that restores both. */
export function installSeriesPalette(): () => void {
  const root = document.documentElement;
  const previousTheme = root.dataset.theme;
  root.dataset.theme = "dark";
  SERIES_VARS.forEach((name, i) =>
    root.style.setProperty(name, TEST_SERIES_PALETTE[i % TEST_SERIES_PALETTE.length]),
  );
  return () => {
    SERIES_VARS.forEach((name) => root.style.removeProperty(name));
    if (previousTheme === undefined) delete root.dataset.theme;
    else root.dataset.theme = previousTheme;
  };
}

/** Which arrangement this document describes — the ONE rule all three legs
 *  branch on, so they can never disagree about which mode they are in. */
export function figureMode(document: FigureDocument): CanonicalFigure["mode"] {
  if (document.bindings.facetKey !== null) return "facet";
  const y2 = document.bindings.y2Keys;
  // Mirrors usePlotPayload's own degrade rule: a secondary axis wins over a
  // group binding on screen, and figureSpec.ts refuses the combination outright.
  if (document.bindings.groupKey !== null && !(y2 && y2.length > 0)) return "group";
  return "flat";
}

/** Per-series styling is a comparable property of a FLAT figure only.
 *
 *  FACET (FEATURE-001): faceted plots ignore per-series styling on BOTH paths,
 *  so screen and export genuinely agree by both ignoring it.
 *
 *  GROUP (BUG-016, narrowed 2026-09-14): the two paths do NOT agree, and this
 *  returning `false` records that rather than hiding it. `routes/
 *  export_figures.py`'s `group_col` branch (`:81-85` documents the choice,
 *  `:236-238` implements it) returns `_ResolvedFigure(..., None, ...)` — every
 *  per-series style is dropped from a grouped export and matplotlib's default
 *  cycle takes over — while the canvas gives every level of a channel that
 *  channel's one style. The wire still CARRIES `series_styles`; it is simply
 *  never read on this branch, so comparing that field leg-to-leg was false
 *  comfort (a grouped red/dashed/3px figure draws as three red dashed curves
 *  on screen and three default-coloured solid ones in the PDF, and the
 *  comparison passed). The divergence itself is pinned by
 *  `regressionMatrix.test.ts`'s BUG-016 test, not swept under this flag. */
export function styleComparable(mode: CanonicalFigure["mode"]): boolean {
  return mode === "flat";
}

export function displayLabel(labels: readonly string[], units: readonly string[], ch: number): string {
  const unit = units[ch] ?? "";
  return unit ? `${labels[ch]} (${unit})` : labels[ch];
}

export function dashOf(line: LineStyle | undefined | null): number[] | null {
  const pattern = line ? DASH[line] : undefined;
  return pattern ? [...pattern] : null;
}

/** Mirrors `lib/markers.ts`'s markerDecision for the "Line" default trace —
 *  the only trace the export wire can represent (`buildExportStyles` emits a
 *  marker only for an EXPLICIT `marker` style). */
export function markerOf(style: SeriesStyle | undefined): CanonicalSeries["marker"] {
  return style?.marker ? { shape: style.markerShape ?? "circle", size: style.markerSize ?? 5 } : null;
}

export function canonicalErrorsFromSpans(
  spans: Map<number, ErrorSpan[]>,
  count: number,
): CanonicalError[][] {
  return Array.from({ length: count }, (_unused, p) =>
    (spans.get(p + 1) ?? []).map((s) => ({
      axis: s.axis,
      plus: [...s.plus],
      minus: [...s.minus],
      symmetric: s.plus.length === s.minus.length && s.plus.every((v, i) => v === s.minus[i]),
    })),
  );
}

/** The absolute offset the 2nd display series carries relative to the 1st,
 *  measured from the rendered columns themselves rather than read off a view
 *  field — so a path that does not apply the waterfall reports 0 honestly. */
export function measureWaterfall(before: PlotPayload, after: PlotPayload): number {
  const b = before.data[2] as (number | null)[] | undefined;
  const a = after.data[2] as (number | null)[] | undefined;
  if (!b || !a) return 0;
  for (let i = 0; i < b.length; i++) {
    const x = b[i];
    const y = a[i];
    if (x != null && y != null && Number.isFinite(x) && Number.isFinite(y)) return y - x;
  }
  return 0;
}

/** Level identity for a grouped figure, read from whichever DataStruct the
 *  calling leg actually carries (the live data, the wire `spec.dataset`, or
 *  the reopened one) — `level_order` + `cat_levels` are the two fields a
 *  reopen or a wire-prune can silently drop. */
export function groupingOf(data: DataStruct, channel: number | null): CanonicalFigure["grouping"] {
  if (channel === null) return { channel: null, levelOrder: null, levelLabels: null };
  const order = levelOrderFor(data, channel);
  const levels = order ? order.filter((v): v is number => typeof v === "number") : null;
  return {
    channel,
    levelOrder: levels ? [...levels] : null,
    levelLabels: levels ? levels.map((code) => groupLevelLabel(data, channel, code)) : null,
  };
}

/** The facet partition. `wire` (the export leg) projects the panels ACTUALLY
 *  put on the wire; the other legs resolve them through `facetPayloads`, the
 *  same primitive `lib/facet.facetCompositionFromBinding` renders from and
 *  `lib/figureSpecFacets.ts` builds the wire panels with. */
export function facetOf(
  data: DataStruct,
  channel: number | null,
  xKey: number | null,
  yKeys: number[] | null,
  wire?: readonly { label: string; series: readonly { label: string }[] }[] | null,
): CanonicalFigure["facet"] {
  if (channel === null) return { channel: null, panels: null };
  if (wire) {
    return { channel, panels: wire.map((p) => ({ label: p.label, series: p.series.map((s) => s.label) })) };
  }
  return {
    channel,
    panels: facetPayloads(data, channel, xKey, yKeys).map((p) => ({
      label: p.label,
      series: p.payload.series.map((s) => (s.unit ? `${s.label} (${s.unit})` : s.label)),
    })),
  };
}

export function decorOf(view: PlotView): CanonicalDecor {
  return {
    legend: {
      show: view.showLegend,
      position: view.showLegend ? view.legendPos : null,
      title: view.legendTitle ?? null,
    },
    annotations: view.annotations
      .filter((a) => Number.isFinite(a.x) && Number.isFinite(a.y))
      .map((a) => ({ x: a.x, y: a.y, text: a.text })),
    shapes: view.shapes
      .filter((s) => [s.x1, s.y1, s.x2, s.y2].every(Number.isFinite))
      .map((s) => ({ kind: s.kind, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 })),
    refLines: view.refLines
      .filter((r) => Number.isFinite(r.value))
      .map((r) => ({ axis: r.axis, value: r.value })),
    regionShades: view.regionShades
      .filter((r) => [r.x1, r.x2, r.y1, r.y2].every(Number.isFinite))
      .map((r) => ({ x1: r.x1, x2: r.x2, y1: r.y1, y2: r.y2, fill: r.fill })),
  };
}

export function limitsOf(lim: readonly [number, number] | null | undefined): [number, number] | null {
  return lim && lim.every(Number.isFinite) ? [lim[0], lim[1]] : null;
}
