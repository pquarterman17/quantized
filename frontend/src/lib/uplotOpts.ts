// Build uPlot options from live design tokens, so the plot restyles for free
// when theme/accent change. The plot canvas stays dark in both themes.

import type uPlot from "uplot";

import type { ColorScatterSpec } from "./colorscatter";
import { resolveDrawColor } from "./contrastColor";
import { FILLED_SHAPES, markerPaths } from "./markers";
import type { Measurement } from "./measure";
import type { FwhmResult } from "./peakwidth";
import type { PlotBg } from "./plotview";
import type { PlotPayload } from "./plotdata";
import type { GadgetMode } from "./quickfit";
import type { RegionStats } from "./regionStats";
import { richLabelAst, type RichNode } from "./richtext";
import { decimalsForIncrement, pow10 } from "./ticks";
import type { Annotation, AxisFormat, AxisScale, LineStyle, RefLine, RegionShade, SeriesStyle, Shape } from "./types";
import { resolveFillBands, seriesFillProps } from "./uplotFill";
import {
  annotationPlugin,
  axisBoxPlugin,
  colorScatterPlugin,
  errorBarsPlugin,
  refLinePlugin,
  regionShadePlugin,
  type AnnotationEditOpts,
} from "./uplotOverlays";
import { richLabelsPlugin, type AxisLabelEditOpts } from "./uplotRichLabels";
import { shapesPlugin, type ShapeEditOpts } from "./uplotShapes";
import { gadgetCursorsPlugin, quickFitPlugin } from "./uplotGadgets";
import { peakMarkerEditPlugin, type PeakMarkerCandidate } from "./peakMarkerHit";
import { anchorEditPlugin, type AnchorPoint } from "./uplotAnchors";
import { fwhmPlugin, integratePlugin } from "./uplotRegionTools";
import {
  measurePlugin,
  panPlugin,
  readoutPlugin,
  statsPlugin,
  viewHistoryPlugin,
  wheelZoomPlugin,
  type PlotViewBounds,
  type Readout,
} from "./uplotTools";

export type PlotTool =
  | "pointer"
  | "zoom"
  | "pan"
  | "cursor"
  | "region"
  | "select"
  | "measure"
  | "stats"
  | "integ"
  | "fwhm"
  | "qfit";

/** Exported for `useAnnotationEdit`'s Frame "Solid" preset (MAIN #27), which
 *  needs a concrete resolved surface color to draw behind text — a canvas
 *  `fillStyle` can't take a live `var(--x)` reference the way DOM CSS can. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** uPlot concatenates every plugin hook value and later calls each entry.
 * Optional draw-only hooks are represented as `undefined` by several plugin
 * factories; omit those keys before uPlot can turn them into `[undefined]`. */
function compactPluginHooks(plugin: uPlot.Plugin): uPlot.Plugin {
  const hooks = Object.fromEntries(
    Object.entries(plugin.hooks).filter(([, callback]) => callback !== undefined),
  ) as uPlot.Plugin["hooks"];
  return { ...plugin, hooks };
}

/** The concrete design-token values a plot window's EFFECTIVE background
 *  resolves to (item 18, owner request 2026-07-09): the canvas background
 *  colour (for the hosting DOM element's inline style — uPlot itself has no
 *  "background" option; it draws on a transparent canvas over whatever CSS
 *  supplies), the grid/ink colours `buildOpts` draws axes/overlays with, and
 *  whether that background reads as dark (feeds `resolveDrawColor`'s
 *  contrast math below). "theme" (default) reproduces today's behaviour —
 *  the plot canvas stays dark regardless of the app's global light/dark
 *  theme (see `styles/colors.css`'s `--axes-bg` doc) — until a window is
 *  explicitly pinned to "light" (Origin's white graph page) or "dark". The
 *  "dark"/"light" token pairs are MODE-scoped, not theme-scoped (same value
 *  regardless of the app's `[data-theme]` — see colors.css), so a window
 *  stays correctly readable even when its own override disagrees with the
 *  surrounding chrome's theme. The single resolution chokepoint: both
 *  `buildOpts` (canvas draw colours) and the window-chrome components
 *  (`PlotStage`/`PlotWindowFrame`, inline container background) call this. */
export interface PlotBgTokens {
  axesBg: string;
  gridColor: string;
  inkColor: string;
  inkDimColor: string;
  isDark: boolean;
}

export function resolvePlotBg(bg?: PlotBg): PlotBgTokens {
  if ((bg ?? "theme") === "light") {
    return {
      axesBg: cssVar("--axes-bg-light") || "#f7f7fa",
      gridColor: cssVar("--grid-line-light") || "#ccc",
      inkColor: cssVar("--ink-on-light") || "#222",
      inkDimColor: cssVar("--ink-dim-on-light") || "#555",
      isDark: false,
    };
  }
  return {
    axesBg: cssVar("--axes-bg") || "#13131a",
    gridColor: cssVar("--grid-line") || "#333",
    inkColor: cssVar("--ink-on-dark") || "#eee",
    inkDimColor: cssVar("--ink-dim-on-dark") || "#aaa",
    isDark: true,
  };
}

export const SERIES_VARS = [
  "--series-1",
  "--series-2",
  "--series-3",
  "--series-4",
  "--series-5",
  "--series-6",
  "--series-7",
  "--series-8",
];

/** Dash patterns (canvas setLineDash arrays) per line style; solid = no dash. */
const DASH: Record<LineStyle, number[] | undefined> = {
  solid: undefined,
  dashed: [8, 4],
  dotted: [2, 4],
};

/** A uPlot axis `values` callback: maps tick split values to label strings. */
type TickValues = (
  self: uPlot,
  splits: number[],
  axisIdx: number,
  foundSpace: number,
  foundIncr: number,
) => (string | number | null)[];

/** The smallest positive gap between consecutive (sorted, finite, non-null)
 *  tick SPLITS — the increment that actually governs label precision,
 *  independent of which generator produced the splits. uPlot's own
 *  `foundIncr` (the 5th `values` argument) reflects a generic linear-
 *  increment search over `[scaleMin, scaleMax]` that ALWAYS runs internally,
 *  even when this module supplies a custom `axis.splits` override
 *  (`fixedLogAxisSplits`/`reciprocalAxisSplits` above) — so `foundIncr` can
 *  silently disagree with the spacing of the splits actually drawn there.
 *  Deriving the increment directly from the splits array is correct
 *  regardless of scale/override, and is the primary source; `foundIncr` is
 *  only a fallback for the (single-split, no diffable pair) degenerate
 *  case. */
function splitsIncrement(splits: readonly (number | null | undefined)[], foundIncr: number): number {
  const vals = splits
    .filter((v): v is number => v != null && Number.isFinite(v))
    .slice()
    .sort((a, b) => a - b);
  let min = Infinity;
  for (let i = 1; i < vals.length; i++) {
    const gap = vals[i] - vals[i - 1];
    if (gap > 0 && gap < min) min = gap;
  }
  return Number.isFinite(min) ? min : foundIncr;
}

/** Strip a rounded-to-zero value's leading minus sign: a legitimately
 *  non-zero split (e.g. -0.00003) can still format as "-0"/"-0.000"/
 *  "-0.0e+0" once rounded to the tick's display precision, which is never
 *  meaningful data (MAIN #20 — the owner's screenshot showed a bare "-0"
 *  tick label on a dense M-H moment axis). Works after ANY formatter
 *  (toFixed/toExponential/Intl.NumberFormat) by re-parsing the FORMATTED
 *  string rather than inspecting the pre-format float, so it's agnostic to
 *  locale grouping separators / exponent suffixes. */
function stripNegZero(formatted: string): string {
  if (!formatted.startsWith("-")) return formatted;
  const bare = formatted.slice(1);
  return Number(bare.replace(/,/g, "")) === 0 ? bare : formatted;
}

const autoNumberFormatCache = new Map<number, Intl.NumberFormat>();
function autoNumberFormat(maxFrac: number): Intl.NumberFormat {
  const key = Math.max(0, Math.min(20, maxFrac));
  let nf = autoNumberFormatCache.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: key });
    autoNumberFormatCache.set(key, nf);
  }
  return nf;
}

/** uPlot's OWN default axis `values` formatter (`numAxisVals` in its
 *  source, `dist/uPlot.esm.js`) is `splits.map(v => fmtNum(v))`, where
 *  `fmtNum` is a bare `Intl.NumberFormat(locale).format(v)` with NO options
 *  — the ECMA-402 spec default caps `maximumFractionDigits` at 3
 *  REGARDLESS of the actual tick increment, and never consults `foundIncr`
 *  at all. This is the confirmed mechanism behind the owner's dense M-H
 *  moment-axis bug report (Moment (emu), range +-0.002, ticks ~0.0001
 *  apart -> every label rounds to 3 decimals -> long duplicate runs:
 *  "0.001"x8, "0"x5, "-0.001"x9, plus a bare "-0" — reproduced via
 *  `tools/visual` with `yFmt` still at the untouched default
 *  `{mode:"auto"}`, no fixed/sci path involved; the healthy X axis in the
 *  same screenshot (Field, integer Oe values) never needed >0 fraction
 *  digits, so it never showed the bug). This replaces `undefined` (defer to
 *  uPlot's own formatter) as the "auto" mode's `values` callback: SAME
 *  Intl locale-grouping behaviour uPlot already provides (so a healthy
 *  range renders byte-identical — see uplotOpts.test.ts's auto-mode
 *  regression case), but with a `splitsIncrement`-derived floor instead of
 *  a hardcoded 3. */
const autoTickValues: TickValues = (_u, splits, _axisIdx, _foundSpace, foundIncr) => {
  const incr = splitsIncrement(splits, foundIncr);
  const nf = autoNumberFormat(decimalsForIncrement(incr));
  return splits.map((v) => (v == null ? null : stripNegZero(nf.format(v))));
};

/** Decimal places needed for a value's MANTISSA (sci/eng modes) so that two
 *  ticks `incr` apart in the SAME decade never format to the same digits —
 *  `incr` is rescaled into the mantissa's own units (divided by the same
 *  `10^exp` the value itself is) before flooring via `decimalsForIncrement`. */
function mantissaDecimalFloor(incr: number, exp: number): number {
  return incr > 0 ? decimalsForIncrement(incr / pow10(exp)) : 0;
}

/** Engineering notation: mantissa in [1, 1000), exponent a multiple of 3
 *  (e.g. `1.2e-3`, `12.3e-6`, `500e-6`) — matches `sci` mode's plain
 *  `toExponential`-family string style (no rich ×10^n markup; see the
 *  BuildOptsArgs doc for why the rich-text axis pipeline isn't coupled in
 *  here). `v === 0` has no meaningful exponent, so it renders bare "0"
 *  rather than e.g. "0e+0". A mantissa that rounds up to >= 1000 (e.g.
 *  999.9996 at 0 mantissa decimals) bumps the exponent by 3 and re-divides,
 *  keeping the mantissa in-range. */
function formatEng(v: number, digits: number, incr: number): string {
  if (v === 0) return "0";
  const sign = v < 0 ? "-" : "";
  const av = Math.abs(v);
  let exp = Math.floor(Math.floor(Math.log10(av)) / 3) * 3;
  const d = Math.max(digits, mantissaDecimalFloor(incr, exp));
  let mantissa = av / pow10(exp);
  let mStr = mantissa.toFixed(Math.min(20, d));
  if (Number(mStr) >= 1000) {
    exp += 3;
    mantissa = av / pow10(exp);
    mStr = mantissa.toFixed(Math.min(20, d));
  }
  return stripNegZero(`${sign}${mStr}e${exp >= 0 ? "+" : ""}${exp}`);
}

/** uPlot `tzDate` pinning calendar tick placement to UTC: return a Date whose
 *  LOCAL accessors (which uPlot uses to find day/month/year boundaries) read
 *  the UTC field values. `getTimezoneOffset` is evaluated at that instant, so
 *  DST is handled per timestamp. */
export function utcTzDate(ts: number): Date {
  const at = new Date(ts * 1_000);
  return new Date(at.getTime() + at.getTimezoneOffset() * 60_000);
}

const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_MINUTE = 60;
const _dateFormatters = new Map<string, Intl.DateTimeFormat>();

/** Pick the date/time resolution from the ACTUAL tick spacing, so a date axis
 *  obeys the same "two different ticks can never share a label" guarantee the
 *  numeric modes get by flooring `digits` at the increment.
 *
 *  A fixed template broke it in both directions: `date` over an hourly span
 *  printed the same "Jan 01, 2026" on every tick, and `time` over a multi-day
 *  span printed a wall clock that silently jumped between days. So widen when
 *  the ticks are closer together than the template resolves, and add the
 *  calendar date when they are further apart than a day. */
function dateTickFormatter(
  mode: "date" | "time" | "datetime",
  incr: number,
): Intl.DateTimeFormat {
  const step = Number.isFinite(incr) && incr > 0 ? incr : 0;
  const wantDate = mode !== "time" || step >= SECONDS_PER_DAY;
  const wantClock = mode !== "date" || (step > 0 && step < SECONDS_PER_DAY);
  // `time` keeps seconds by default (its historical shape); the others only
  // add them once the ticks are closer together than a minute.
  const wantSeconds = wantClock
    && (mode === "time" ? step === 0 || step < SECONDS_PER_MINUTE : step > 0 && step < SECONDS_PER_MINUTE);
  const key = `${wantDate}|${wantClock}|${wantSeconds}`;
  const cached = _dateFormatters.get(key);
  if (cached) return cached;
  const options: Intl.DateTimeFormatOptions = { timeZone: "UTC" };
  if (wantDate) {
    options.year = "numeric";
    options.month = "short";
    options.day = "2-digit";
  }
  if (wantClock) {
    options.hour = "2-digit";
    options.minute = "2-digit";
    options.hour12 = false;
  }
  if (wantSeconds) options.second = "2-digit";
  const built = new Intl.DateTimeFormat(undefined, options);
  _dateFormatters.set(key, built);
  return built;
}

/** Build a uPlot axis `values` formatter for a tick mode. `auto` no longer
 *  defers to uPlot's own formatter (see `autoTickValues`'s doc for why);
 *  `fixed`/`sci`/`eng` each floor their configured `digits` at what the
 *  actual tick increment (`splitsIncrement`) needs, so a dense axis can
 *  never render two different ticks with the same label. */
export function tickFormatter(fmt?: AxisFormat): TickValues {
  const mode = fmt?.mode ?? "auto";
  if (mode === "auto") return autoTickValues;
  if (mode === "date" || mode === "time" || mode === "datetime") {
    // `Intl.DateTimeFormat.format(new Date(x))` throws RangeError ("Invalid
    // time value") for NaN AND for any FINITE value beyond the ECMA-262 Date
    // range (±8.64e15 ms, i.e. |seconds| > 8.64e12) — which a date format
    // applied to a physics/epoch-ms axis easily exceeds. uPlot has no error
    // boundary, so an uncaught throw here breaks the whole draw. Degrade to a
    // blank tick, mirroring the backend's `_AxisTickFormatter` exactly.
    return (_u, splits, _axisIdx, _foundSpace, foundIncr) => {
      const formatter = dateTickFormatter(mode, splitsIncrement(splits, foundIncr));
      return splits.map((value) => {
        if (value == null || !Number.isFinite(value)) return null;
        try {
          return formatter.format(new Date(value * 1_000));
        } catch {
          return null;
        }
      });
    };
  }
  const digits = fmt ? Math.max(0, Math.min(20, Math.round(fmt.digits))) : 2;
  if (mode === "sci") {
    return (_u, splits, _axisIdx, _foundSpace, foundIncr) => {
      const incr = splitsIncrement(splits, foundIncr);
      return splits.map((v) => {
        if (v == null) return null;
        const exp = v === 0 ? 0 : Math.floor(Math.log10(Math.abs(v)));
        const d = Math.max(digits, mantissaDecimalFloor(incr, exp));
        return stripNegZero(v.toExponential(Math.min(20, d)));
      });
    };
  }
  if (mode === "eng") {
    return (_u, splits, _axisIdx, _foundSpace, foundIncr) => {
      const incr = splitsIncrement(splits, foundIncr);
      return splits.map((v) => (v == null ? null : formatEng(v, digits, incr)));
    };
  }
  // fixed
  return (_u, splits, _axisIdx, _foundSpace, foundIncr) => {
    const incr = splitsIncrement(splits, foundIncr);
    const d = Math.max(digits, decimalsForIncrement(incr));
    return splits.map((v) => (v == null ? null : stripNegZero(v.toFixed(Math.min(20, d)))));
  };
}

/** Build a uPlot axis `values` formatter for a categorical x-axis
 *  (`PlotPayload.xCategories`, gap #20): `data[0]` holds ORDINAL positions
 *  (0, 1, 2, …), so a tick maps to its label only when it lands exactly on an
 *  in-range integer index — a fractional split (uPlot may propose one
 *  between categories at some zoom levels) or an out-of-range one renders
 *  blank rather than a misleading label. */
export function categoricalTickFormatter(categories: readonly string[]): TickValues {
  return (_u, splits) =>
    splits.map((v) => {
      if (v == null) return null;
      const i = Math.round(v);
      return i >= 0 && i < categories.length && Math.abs(v - i) < 1e-6 ? categories[i] : "";
    });
}

/** A "nice" linear tick step (1/2/5 × 10^n) for a span with no decoded Origin
 *  increment to anchor to — the classic tick-step heuristic, aiming for
 *  roughly `targetTicks` ticks across the span. Used by `fixedLogAxisSplits`
 *  for the sub-decade case when `step` is undecoded. */
export function niceLinearStep(span: number, targetTicks = 5): number {
  if (!(span > 0)) return 1;
  const raw = span / Math.max(1, targetTicks);
  const mag = pow10(Math.floor(Math.log10(raw)));
  const residual = raw / mag;
  const nice = residual < 1.5 ? 1 : residual < 3 ? 2 : residual < 7 ? 5 : 10;
  return nice * mag;
}

/** Major ticks for a fixed linear Origin axis. Origin stores the increment
 * independently of the range; ticks land on integer multiples of that
 * increment inside the visible bounds (for example -7000..7000 by 2000 ->
 * -6000,-4000,...,6000). Invalid/inverted inputs fail closed. */
export function fixedLinearAxisSplits(min: number, max: number, step: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step)
      || !(max > min) || !(step > 0)) return [];
  const EPS = 1e-9;
  const n0 = Math.ceil(min / step - EPS);
  const n1 = Math.floor(max / step + EPS);
  // A corrupt decode must not lock the UI by allocating millions of ticks.
  // Returning no custom splits lets uPlot keep its safe default behavior.
  if (n1 - n0 + 1 > 1000) return [];
  const out: number[] = [];
  for (let n = n0; n <= n1; n++) out.push(cleanStepValue(n * step));
  return out;
}

/** Undo float noise from `n * step` accumulation (e.g. `0.1 * 8` reading as
 *  `0.7999999999999999`) so a generated tick prints as the clean decimal it
 *  is meant to be. Ticks are display values, not analysis inputs, so this
 *  precision is more than enough. */
function cleanStepValue(v: number): number {
  return Number(v.toPrecision(12));
}

/** Log-axis tick positions for a FIXED [min, max] range — an applied Origin
 *  figure's saved axis bounds, or a hand-typed Inspector AxisLimits range.
 *  Supplied as uPlot's `axis.splits` OVERRIDE (see `buildOpts`) so it never
 *  falls through to uPlot's own internal log-splits generator, which anchors
 *  its first tick at the raw (unrounded) scaleMin — correct for an
 *  autoscaled range (`rangeLog` rounds the bounds to a decade first), but
 *  wrong for a FIXED range, whose bounds are whatever the figure/user typed
 *  (e.g. Origin's real sub-decade views "Graph50"/"Graph52" in PNR.opj:
 *  y in [0.7139, 1.2732] and [0.9772, 1.2916]) — the plot-fidelity bug this
 *  fixes (ticks like [0.7139, 0.8, 0.9, 1] instead of [0.8, 0.9, 1, 1.1, 1.2]).
 *
 *  - Span ≥ 1 decade: 1–9 subdivisions within every decade. The axis label
 *    filter below keeps text only at powers of ten; the other splits draw
 *    Origin-style minor ticks and grid subdivisions.
 *  - Span < 1 decade: ticks stepped arithmetically in LINEAR y-space. `step`
 *    (Origin's decoded major-tick increment) is a LINEAR increment on a log
 *    axis, not a log10/decade multiplier — verified against PNR.opj's
 *    Graph50 (step 0.1 -> ticks 0.8/0.9/1.0/1.1/1.2) and Graph52 (step 0.05).
 *    No decoded step -> `niceLinearStep` picks one.
 *
 *  Degenerate ranges (non-positive, or inverted/zero-width) return `[]`
 *  (uPlot draws the axis line with no ticks rather than garbage). */
export function fixedLogAxisSplits(min: number, max: number, step?: number | null): number[] {
  if (!(min > 0) || !(max > min)) return [];
  const EPS = 1e-9;
  const decades = Math.log10(max / min);
  if (decades >= 1 - EPS) {
    const lo = Math.floor(Math.log10(min) + EPS);
    const hi = Math.ceil(Math.log10(max) - EPS);
    const out: number[] = [];
    for (let k = lo; k <= hi; k++) {
      // pow10, not Math.pow: decade ticks must be the EXACT double for 10^k
      // on every platform (V8's pow drifts on some builds — the CI-only
      // 9.999999999999999e-6 failure of 2026-07-10).
      const decade = pow10(k);
      for (let m = 1; m <= 9; m++) {
        const v = m * decade;
        if (v >= min * (1 - EPS) && v <= max * (1 + EPS)) out.push(v);
      }
    }
    return out;
  }
  const s = step && step > 0 ? step : niceLinearStep(max - min);
  const n0 = Math.ceil(min / s - EPS);
  const n1 = Math.floor(max / s + EPS);
  const out: number[] = [];
  for (let n = n0; n <= n1; n++) out.push(cleanStepValue(n * s));
  return out;
}

/** Keep labels only on decade anchors while retaining 2-9 subdivisions as
 * splits for log grid lines and tick marks. Sub-decade Origin axes use their
 * decoded arithmetic step, so every split remains a labeled major tick. */
export function logMajorTickFilter(
  _u: uPlot,
  splits: number[],
): (number | null)[] {
  const positive = splits.filter((v) => Number.isFinite(v) && v > 0);
  if (positive.length < 2 || positive[positive.length - 1] / positive[0] < 10 * (1 - 1e-9)) {
    return splits;
  }
  return splits.map((v) => {
    if (!(v > 0)) return null;
    const exp = Math.log10(v);
    return Math.abs(exp - Math.round(exp)) < 1e-9 ? v : null;
  });
}

// ── Reciprocal (1/x) scale — MAIN #12, Arrhenius-style plots ────────────────
//
// uPlot has no built-in reciprocal distribution; its custom-scale mechanism
// (`scales.<key>.distr: 100` + `fwd`/`bwd` transform callbacks — the
// `Scale.Distr.Custom` value in uplot's own types) is the sanctioned hook for
// exactly this (see the doc on `Scale.fwd`/`Scale.bwd`). `fwd` maps a DATA
// value to the internal linear-positioning space uPlot pixel-interpolates in
// (`pct = (fwd(val) - fwd(scaleMin)) / (fwd(scaleMax) - fwd(scaleMin))`);
// `bwd` is its inverse, used for `posToVal` (cursor/rubber-band) and value
// readback. 1/x is its own inverse (f(f(x)) = x for x != 0), so ONE function
// serves both roles — verified against uplot's source: `getValPct` computes
// `pct` from `fwd` alone and is affine in `fwd(val)`, so it stays correctly
// monotonic (low DATA value at the low-pct/left edge, same left-to-right
// ordering as linear/log) even though `1/x` itself is a DECREASING function
// on x>0 — the endpoints just aren't evenly spaced in between, which is
// exactly the desired Arrhenius-plot effect (tick density piles up at one
// end). This is why `scale.min`/`scale.max` stay plain data-space extents,
// same as any other axis: no separate "reciprocal range" convention needed.

/** The reciprocal transform: `fwd` AND `bwd` for a uPlot `distr: 100` scale
 *  (self-inverse). Non-positive input degrades gracefully to `NaN` (uPlot /
 *  the browser canvas simply skip a NaN pixel position) rather than `Infinity`
 *  — the SAME domain restriction the log scale already has (see
 *  `fullXExtents`/`fullYExtents`'s `log && v <= 0` guard, reused verbatim for
 *  `reciprocal`): physically this covers the Arrhenius case (T in Kelvin is
 *  always positive) without needing to reason about a pole-in-range sign
 *  flip for data that legitimately straddles zero. */
export function reciprocalTransform(v: number): number {
  return v > 0 ? 1 / v : NaN;
}

/** Reciprocal-axis tick positions for a `[min, max]` data-space range: pick
 *  "nice" round values EVENLY SPACED IN 1/x SPACE (mirroring
 *  `fixedLogAxisSplits`'s decade/step logic, but for the reciprocal
 *  transform), then map each back to its ORIGINAL x value — so the ticks
 *  render at reciprocal-spaced pixel positions while the LABEL reads the
 *  natural variable (e.g. T in Kelvin), matching Origin's "Reciprocal" axis
 *  type convention referenced in the task brief. `targetTicks` is the same
 *  "aim for about N ticks" knob `niceLinearStep` takes. Degenerate ranges
 *  (non-positive, or inverted/zero-width — same domain as `fixedLogAxisSplits`)
 *  return `[]`. */
export function reciprocalAxisSplits(min: number, max: number, targetTicks = 5): number[] {
  if (!(min > 0) || !(max > min)) return [];
  const r0 = reciprocalTransform(min); // larger (smaller x -> larger 1/x)
  const r1 = reciprocalTransform(max); // smaller
  const rLo = Math.min(r0, r1);
  const rHi = Math.max(r0, r1);
  if (!(rHi > rLo)) return [min, max];
  const step = niceLinearStep(rHi - rLo, targetTicks);
  const EPS = 1e-9;
  const n0 = Math.ceil(rLo / step - EPS);
  const n1 = Math.floor(rHi / step + EPS);
  const out: number[] = [];
  for (let n = n0; n <= n1; n++) {
    const r = cleanStepValue(n * step);
    if (r === 0) continue; // 1/0 is undefined — skip the (rare) exact-zero tick
    const v = cleanStepValue(reciprocalTransform(r));
    if (v >= min * (1 - EPS) && v <= max * (1 + EPS)) out.push(v);
  }
  return out.sort((a, b) => a - b);
}

/** Is the x column sorted ascending? uPlot's x scale defaults to `sorted: 1`,
 *  meaning it derives the scale range from the *endpoints* (a binary-search
 *  optimization) instead of scanning. That assumption breaks for non-monotonic x
 *  — e.g. a magnetometry M-vs-H hysteresis loop sweeps field up then down, so the
 *  first/last points are both at +saturation and uPlot collapses the x-range to a
 *  sliver → a blank plot. Detect it so we can fall back to `Unsorted` (scan all
 *  points). Nulls are skipped (they don't break monotonicity). */
export function xIsAscending(xs: readonly (number | null)[]): boolean {
  let prev = -Infinity;
  for (const v of xs) {
    if (v == null) continue;
    if (v < prev) return false;
    prev = v;
  }
  return true;
}

/** Effective stroke for display-series `i`: an explicit override (token name or
 *  literal hex) wins, else the palette color by position. A `"--token"` color is
 *  resolved through `cssVar` so it stays re-themeable; a literal passes through. */
export function seriesColor(i: number, style?: SeriesStyle): string {
  const c = style?.color;
  if (c) return c.startsWith("--") ? cssVar(c) || c : c;
  return cssVar(SERIES_VARS[i % SERIES_VARS.length]) || "#8b5cf6";
}

export interface BuildOptsArgs {
  width: number;
  height: number;
  /** Axis scale (MAIN #12 — linear/log/reciprocal), replacing the old
   *  `yLog`/`xLog` booleans as the source of truth. `"reciprocal"` positions
   *  by 1/value (uPlot custom `distr: 100`) with tick labels in the original
   *  data units — see `reciprocalTransform`/`reciprocalAxisSplits` above. */
  yScale: AxisScale;
  xScale: AxisScale;
  tool: PlotTool;
  onReadout: (r: Readout | null) => void;
  /** In `region` tool: called with the two data-x edges of a completed drag
   *  (unordered). Used by the baseline "Fit from region" rubber-band. */
  onRegionSelect?: (x0: number, x1: number) => void;
  /** #50 plot-brush: drag-end x-band edges for the "select" tool. */
  onRangeSelect?: (x0: number, x1: number) => void;
  /** In `measure` tool: called with the live Δx/Δy/slope while dragging the
   *  two-point ruler (null when the ruler is cleared). */
  onMeasure?: (m: Measurement | null) => void;
  /** In `stats` tool: called with the live per-series summary stats over the
   *  dragged x-band (null when the band is empty / zero-width). */
  onStats?: (s: RegionStats | null) => void;
  /** Committed integral region (drawn persistently until cleared / dataset change). */
  integral?: { xlo: number; xhi: number; area: number } | null;
  /** In `integ` tool: commit the trapezoidal area over a completed drag. */
  onIntegrate?: (r: { xlo: number; xhi: number; area: number }) => void;
  /** Committed peak/FWHM result (drawn persistently until cleared / dataset change). */
  fwhmResult?: FwhmResult | null;
  /** In `fwhm` tool: commit the peak + FWHM estimate over a completed drag. */
  onFwhm?: (r: FwhmResult) => void;
  /** Quick-fit gadget (#33) ROI band, in data coords (null = none committed
   *  yet). Persists across draws while the `qfit` tool is active; the tool
   *  clears it (and the fit overlay/chip) on tool switch — see PlotStage. */
  qfitRoi?: [number, number] | null;
  /** In `qfit` tool: fires on every create/move/resize of the ROI band (data
   *  coords; null = a sub-6px drag cleared it). The caller debounces the
   *  actual re-fit request — see the store's `setQfitRoi`. */
  onRoiChange?: (roi: [number, number] | null) => void;
  /** ROI gadget family (#34): which gadget is selected on the chip. When
   *  `"cursors"`, the `qfit` tool swaps its plugin from the ROI band
   *  (quickFitPlugin) to the paired-cursors drag (gadgetCursorsPlugin) — the
   *  rest of the modes (fit/integrate/stats/differentiate/fft) all share the
   *  same ROI band, only what the store computes from it differs. */
  gadgetMode?: GadgetMode;
  /** Cursors-mode positions, in data coords (null = none placed yet). */
  gadgetCursors?: [number, number] | null;
  /** In `qfit` tool + cursors mode: fires on every create/move of a cursor. */
  onCursorsChange?: (c: [number, number] | null) => void;
  /** Peak Analyzer wizard click-on-plot marker editing (interaction item 5,
   *  deferred from closed gap #31): non-null only while wizard step ② is
   *  live (see PlotStage's `peakWizardEdit` store read). Independent of
   *  `tool` — like wheelZoom, it composes with whatever tool is active; only
   *  a plain (non-drag) click over the plot acts. */
  peakWizardEdit?: {
    markers: PeakMarkerCandidate[];
    onAdd: (x: number) => void;
    onRemove: (index: number) => void;
  } | null;
  /** Anchor-point baseline editing (GOTO #2): non-null only while the
   *  Baseline workshop's "Anchor points" method is live (see PlotStage's
   *  `baselineAnchorEdit` store read). Composes with any tool like
   *  peakWizardEdit — plain clicks add/remove anchors, dragging a marker
   *  moves it (capture-phase beats box-zoom for that gesture only).
   *  `getAnchors` is a live getter, not a snapshot (MAIN #8f): the plugin
   *  pulls the current list per event/draw so anchor edits don't need a
   *  rebuild of this opts object or the uPlot instance. */
  anchorEdit?: {
    getAnchors: () => readonly AnchorPoint[];
    onAdd: (x: number, y: number) => void;
    onMove: (index: number, x: number, y: number) => void;
    onRemove: (index: number) => void;
  } | null;
  /** Explicit axis ranges (null = uPlot autoscale). Fix the axis Origin-style. */
  xLim?: [number, number] | null;
  yLim?: [number, number] | null;
  /** Secondary (right) Y axis: explicit range + scale. An applied Origin
   *  double-Y figure carries layer 2's own axis state here; null/undefined =
   *  autoscale / inherit yScale (the pre-2026-07-06 behaviour). */
  y2Lim?: [number, number] | null;
  y2Scale?: AxisScale | null;
  /** Reference lines to draw at fixed X/Y values. */
  refLines?: RefLine[];
  /** Commit a dragged reference line's new value (zoom/cursor tools only — the
   *  pan/measure/region tools own the drag gesture, so dragging is disabled). */
  onRefLineMove?: (id: string, value: number) => void;
  /** Text annotations pinned at data coordinates. */
  annotations?: Annotation[];
  /** Pointer-tool direct manipulation (MAIN #18): select/drag-move/corner-
   *  resize/double-click-edit/right-click-menu for `annotations`. Non-null
   *  only while the pointer tool is active — see `PlotStage`'s
   *  `useAnnotationEdit` hook, which supplies it. Unlike `anchorEdit`'s
   *  live-getter bridge (baseline anchors churn every animation frame during
   *  a fit preview), an annotation edit is a rare, discrete gesture — a
   *  plain commit-once callback bridge is enough: the store commit rebuilds
   *  this uPlot instance once per GESTURE (same as `onRefLineMove` already
   *  does), never once per pixel (the plugin's own live-drag override in
   *  `annotationPlugin` handles that). */
  annotationEdit?: Omit<AnnotationEditOpts, "interactive"> | null;
  /** Drag-to-reposition the axis titles (pointer tool). Offsets + commit
   *  callbacks; only wired when the tool is "pointer". */
  axisLabelEdit?: AxisLabelEditOpts | null;
  /** Drawn shapes (MAIN #27: arrow/line/rect/ellipse). */
  shapes?: Shape[];
  /** Pointer-tool direct manipulation for `shapes` — same "non-null only in
   *  pointer mode" convention as `annotationEdit` above (see
   *  `useShapeEdit`, which supplies it). */
  shapeEdit?: Omit<ShapeEditOpts, "interactive" | "drawKind" | "onDrawCommit"> | null;
  /** Drag-to-draw a NEW shape (MAIN #27's dock flyout / Insert menu) —
   *  independent of `tool`/pointer mode, composes like peakWizardEdit/
   *  anchorEdit (see `useShapeDraw`, which supplies it). */
  shapeDraw?: Pick<ShapeEditOpts, "drawKind" | "onDrawCommit"> | null;
  /** Filled region bands (Origin Rect* shades, decode-plan #41), drawn
   *  translucently behind the grid/data by regionShadePlugin. */
  regionShades?: RegionShade[];
  /** Per-display-series style overrides, aligned 1:1 with `payload.series`
   *  (undefined entries — e.g. overlays — keep the defaults). */
  seriesStyles?: (SeriesStyle | undefined)[];
  /** Dataset-channel index for each plotted display-series (`usePlotPayload`'s
   *  `plotted` array — the same space `SeriesStyle.fill`'s `vs` and `colorBy`
   *  are expressed in). Only needed to resolve a `fill: {vs: channel}`
   *  override to the OTHER series' display position (see
   *  `uplotFill.resolveFillBands`); undefined = no bands resolved. */
  plotted?: number[];
  /** Per-display-series display-name overrides (legend rename), aligned 1:1 with
   *  `payload.series` (undefined entries keep the dataset's own label + unit). */
  seriesLabels?: (string | undefined)[];
  /** Error-bar magnitudes keyed by uPlot data-column index (1-based). Draws
   *  vertical y±e whiskers for the mapped plotted series. */
  errorBars?: Map<number, (number | null)[]>;
  /** Colour-mapped-scatter specs (MAIN #14), keyed by uPlot data-column index
   *  (1-based) — see `colorscatter.buildColorByColumns`. A series present here
   *  has its native line/points hidden; `colorScatterPlugin` draws it instead. */
  colorByColumns?: Map<number, ColorScatterSpec>;
  /** Per-display-series visibility (aligned 1:1 with `payload.series`); `true`
   *  hides that series (interactive legend). Undefined = all visible. */
  hidden?: boolean[];
  /** Axis tick number formats (auto = uPlot default). y2Fmt null/undefined
   *  inherits yFmt (the compatibility default — see store/useApp.ts's
   *  y2Fmt doc); an explicit y2Fmt formats the secondary axis independently. */
  xFmt?: AxisFormat;
  yFmt?: AxisFormat;
  y2Fmt?: AxisFormat | null;
  /** Draw grid lines (default true). */
  showGrid?: boolean;
  /** Base axis tick/label font size in px (publication template; default 12
   *  as of item 2, 2026-07-09 — was 11). The axis TITLE renders 2px larger
   *  still; see `buildOpts`'s `titlePx`. */
  fontSize?: number;
  /** Default series stroke width when no per-series override (template; default 1.5). */
  baseLineWidth?: number;
  /** Default trace shape for series without an explicit per-series style
   *  (Preferences ▸ Plot ▸ Default trace): "Line" | "Line + markers" | "Scatter"
   *  | "Step". Per-series overrides still win. */
  defaultTrace?: string;
  /** Enable wheel-to-zoom over the plot (Preferences ▸ Interaction ▸ Mouse wheel). */
  wheelZoom?: boolean;
  /** Completed box-zoom/pan/wheel gesture, coalesced to one view-history step. */
  onViewChange?: (before: PlotViewBounds, after: PlotViewBounds) => void;
  /** Stepped path builder (uPlot.paths.stepped) used for the "Step" default trace.
   *  Supplied by the caller so this module stays free of the uPlot *runtime*
   *  (a value import would pull uPlot's matchMedia init into headless tests). */
  steppedPaths?: uPlot.Series.PathBuilder;
  /** Linear/points path builders (uPlot.paths.linear() / .points()), supplied by
   *  the caller for the same runtime-free reason as `steppedPaths`. Used when x
   *  is non-monotonic (hysteresis loops, swept-back scans): uPlot derives its
   *  drawn index window from a binary search over x that assumes ascending
   *  order, so a loop collapses to a sliver — one visible point. These builders
   *  get wrapped to ignore the window and draw every point in acquisition
   *  order, which renders the loop the way the instrument swept it. */
  linearPaths?: uPlot.Series.PathBuilder;
  pointsPaths?: uPlot.Series.Points.PathBuilder;
  /** Draw a full rectangular frame around the plot area (publication "box"). */
  axisBox?: boolean;
  /** Chart title rendered above the plot (blank/undefined = none). */
  title?: string;
  /** Override the x-axis label: a non-empty string shows verbatim; blank
   *  (`""`) or `undefined` derives from the data (today's default, and the
   *  single-plot store convention — see `store/useApp.ts`'s `xAxisLabel`
   *  doc). `null` forces NO title even though data is present — the Origin-
   *  fidelity case (item B, decode-plan #36 residual — PNR.opj Graph11): a
   *  layer whose decoded `x_title` is genuinely `""` (the owner hand-deleted
   *  a redundant per-panel label in Origin) must show nothing, never a
   *  synthesized "channel (unit)" fallback. Only the spatial multi-panel
   *  path (`originFigures.resolveFigurePanels`) ever passes `null`; every
   *  other caller's plain string/undefined behaves exactly as before. */
  xAxisLabel?: string | null;
  /** Override the primary y-axis label; when set it shows even with >1 series
   *  (blank/undefined = the solo-series auto label). */
  yAxisLabel?: string;
  /** Override the secondary y-axis label (Origin double-Y apply carries layer
   *  2's decoded title here); same blank/undefined semantics as yAxisLabel. */
  y2AxisLabel?: string;
  /** Origin's decoded major-tick increment for each axis (see
   *  `fixedLogAxisSplits`'s doc) — only consulted when that axis is BOTH log
   *  AND has a fixed range (xLim/yLim/y2Lim), which is when uPlot's own
   *  decade-snapping is bypassed and this module must supply ticks itself.
   *  null/undefined = undecoded (a "nice number" step fills in instead). */
  xStep?: number | null;
  yStep?: number | null;
  y2Step?: number | null;
  /** This window's background override (item 18) — "theme" (default)
   *  matches today's always-dark plot canvas; "light"/"dark" pin THIS plot
   *  to a fixed background regardless of the app's theme. Resolved via
   *  `resolvePlotBg`. */
  bg?: PlotBg;
}

/** Full-scan [min, max] of the finite values across every visible series on one
 *  scale — the manual counterpart of uPlot's auto-range for non-monotonic x,
 *  where uPlot's own scan window (derived from a binary search over x) is
 *  meaningless. Log AND reciprocal scales consider positive values only (MAIN
 *  #12 — reciprocal has the same domain restriction as log; see
 *  `reciprocalTransform`'s doc). Returns null when nothing qualifies (leave
 *  uPlot's default behaviour alone). */
function fullYExtents(
  payload: PlotPayload,
  hidden: boolean[] | undefined,
  axis: 0 | 1,
  positiveOnly: boolean,
): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  payload.series.forEach((s, i) => {
    if ((s.axis ?? 0) !== axis || hidden?.[i]) return;
    for (const v of payload.data[i + 1] ?? []) {
      if (v == null || !Number.isFinite(v) || (positiveOnly && v <= 0)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  });
  if (min > max) return null;
  if (positiveOnly) return [min / 1.1, max * 1.1];
  const pad = (max - min || Math.abs(max) || 1) * 0.1; // mirror uPlot's soft pad
  return [min - pad, max + pad];
}

/** Full-scan [min, max] of the finite x values, lightly padded — the X
 *  counterpart of fullYExtents. For non-monotonic x (a hysteresis loop sweeps
 *  field up then down, so it starts and ends near the SAME saturation), uPlot's
 *  binary-search autorange collapses the axis to [first, last] — a sliver near
 *  one end. Scanning restores the true sweep width. Log AND reciprocal
 *  consider positive x only. Null when nothing qualifies (leave uPlot's
 *  default alone). */
function fullXExtents(xs: readonly (number | null)[], positiveOnly: boolean): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const v of xs) {
    if (v == null || !Number.isFinite(v) || (positiveOnly && v <= 0)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min > max) return null;
  if (positiveOnly) return [min / 1.1, max * 1.1];
  const pad = (max - min || Math.abs(max) || 1) * 0.02; // slim x margin, avoid edge clipping
  return [min - pad, max + pad];
}

/** Whether `scale` requires positive-only data (log AND reciprocal share the
 *  domain restriction — see `reciprocalTransform`'s doc). */
function isPositiveOnlyScale(scale: AxisScale): boolean {
  return scale === "log" || scale === "reciprocal";
}

/** The uPlot `Scale` distribution props for one axis's scale (MAIN #12):
 *  `"log"` -> `distr: 3` (uPlot's own logarithmic distribution); `"reciprocal"`
 *  -> `distr: 100` (uPlot's custom-scale hook) + the `fwd`/`bwd` transform;
 *  `"linear"` -> `distr: 1` (uPlot's default, spelled out for clarity). */
function scaleDistrProps(
  scale: AxisScale,
): Pick<uPlot.Scale, "distr" | "fwd" | "bwd"> {
  if (scale === "log") return { distr: 3 };
  if (scale === "reciprocal") return { distr: 100, fwd: reciprocalTransform, bwd: reciprocalTransform };
  return { distr: 1 };
}

export function buildOpts(payload: PlotPayload, args: BuildOptsArgs): uPlot.Options {
  const { width, height, yScale, xScale, tool, onReadout, xLim, yLim, refLines, seriesStyles } = args;
  const { xFmt, yFmt, y2Fmt, annotations, showGrid, onRegionSelect } = args;
  const xAscending = xIsAscending(payload.data[0] as (number | null)[]);
  // Non-monotonic x: wrap a path builder so it ignores uPlot's (collapsed)
  // index window and draws the full acquisition order. See `linearPaths` docs.
  const fullLine = (b: uPlot.Series.PathBuilder): uPlot.Series.PathBuilder =>
    (u, sidx) => b(u, sidx, 0, u.data[0].length - 1);
  const fullPoints = (b: uPlot.Series.Points.PathBuilder): uPlot.Series.Points.PathBuilder =>
    (u, sidx, _i0, _i1, filt) => b(u, sidx, 0, u.data[0].length - 1, filt);
  /** Point-marker config for one series honoring the loop fix. */
  const loopPoints = (p: uPlot.Series.Points): uPlot.Series.Points => {
    if (xAscending || !p.show) return p;
    if (p.paths) return { ...p, paths: fullPoints(p.paths) };
    return args.pointsPaths ? { ...p, paths: fullPoints(args.pointsPaths) } : p;
  };
  // This window's EFFECTIVE background (item 18) drives both the axis/grid/
  // ink colours below AND the contrast check on literal per-series colours
  // (`resolveDrawColor` calls further down) — NOT the app's global theme,
  // since a per-window override can disagree with the surrounding chrome.
  const { gridColor, inkColor, inkDimColor, isDark: isDarkBg } = resolvePlotBg(args.bg);
  const axisColor = inkDimColor;
  const accentColor = cssVar("--accent") || "#8b5cf6";
  const accentSoftColor = cssVar("--accent-soft") || "rgba(139,92,246,0.18)";
  const captureSoftColor = cssVar("--capture-soft") || "rgba(200,160,80,0.16)";
  // Owner 2026-07-09 (item 2, "up the default x/y axis legend and label
  // size"): tick-value font 11px -> 12px default (JetBrains Mono kept —
  // ticks are DATA, per typography.css's mono/UI split). The axis TITLE
  // (e.g. "Temperature (K)") is prose, not data, so it gets the UI font
  // instead, explicitly sized (uPlot's own unstyled default was a fixed,
  // un-themed "bold 12px system-ui…" that never tracked a template's
  // fontSize at all) — 2px over the tick value so it SCALES with whichever
  // plot template is active: the screen default lands exactly on the
  // design tokens' --type-title (14px), while a compact export style
  // (APS/Nature) or a large one (Presentation/Poster) keeps its title
  // legibly bigger than its own ticks instead of a fixed size that would
  // look mismatched at those templates' more extreme fontSize choices.
  const tickPx = args.fontSize ?? 12;
  const font = `${tickPx}px ${cssVar("--font-mono") || "monospace"}`;
  const titlePx = tickPx + 2;
  const uiFamily = cssVar("--font-ui") || "system-ui, sans-serif";
  const labelFont = `600 ${titlePx}px ${uiFamily}`;
  // X-axis label: an explicit override wins; `null` forces blank (item B —
  // an Origin layer's own DECODED-EMPTY title must never be re-synthesized);
  // blank/undefined derives "name (unit)" from the data (today's default).
  const xLabel =
    args.xAxisLabel === null
      ? ""
      : args.xAxisLabel?.trim() ||
        (payload.xUnit ? `${payload.xLabel} (${payload.xUnit})` : payload.xLabel);
  // Resolved display label per series: an explicit rename wins, else "label (unit)".
  const labels = payload.series.map((s, i) =>
    args.seriesLabels?.[i] ?? (s.unit ? `${s.label} (${s.unit})` : s.label),
  );
  // Label each Y axis only when it carries a single series (else the legend names
  // them); a non-blank override on the primary axis always wins and forces a label.
  const soloLabel = (which: number): string | undefined => {
    if (which === 0 && args.yAxisLabel?.trim()) return args.yAxisLabel.trim();
    if (which === 1 && args.y2AxisLabel?.trim()) return args.y2AxisLabel.trim();
    const idxs = payload.series.map((_, i) => i).filter((i) => (payload.series[i].axis ?? 0) === which);
    return idxs.length === 1 ? labels[idxs[0]] : undefined;
  };
  const hasY2 = payload.series.some((s) => (s.axis ?? 0) === 1);

  // Rich-text labels (GOTO #5): a label with a VALID `$...$` math region
  // parses to an AST here — the single chokepoint, so EVERY plot window that
  // builds through uplotOpts (stage, snapshot/pinned, multi-panel, waterfall,
  // refl, inset) renders it. The plain uPlot label is blanked below
  // (label: "" still reserves the labelSize band) and richLabelsPlugin draws
  // the AST in that band; the DOM title is swapped in the plugin's init hook.
  // An invalid or $-free label returns null and keeps uPlot's own plain draw
  // byte-identical to before — the same literal fallback the export side
  // applies (calc/figure_labels.py).
  // Route EVERY axis title through the canvas plugin (rich AST if rich, else a
  // plain-text node) so all titles are drag-repositionable — uPlot's own plain
  // label is blanked below. A blank/absent label stays null (nothing drawn).
  // The TITLE stays a DOM element (rich only), not draggable.
  // Each axis title becomes an AST the plugin can measure/draw (rich parse, or
  // a plain-text node so plain titles are still hit-testable + draggable). The
  // plugin DRAWS a title only when it's rich OR has a drag offset — uPlot keeps
  // drawing plain, unmoved titles at their default position (zero change for
  // the common case). `label: ""` blanks uPlot's own draw for exactly the
  // plugin-drawn set.
  const off = args.axisLabelEdit?.offsets ?? {};
  const sty = args.axisLabelEdit?.styles ?? {};
  const astOf = (text: string | undefined): RichNode[] | null =>
    text && text.trim() ? (richLabelAst(text) ?? [{ kind: "text", text, italic: false }]) : null;
  const xRealRich = richLabelAst(xLabel);
  const xRich = astOf(xLabel);
  const xDrawn = !!xRealRich || off.x !== undefined || sty.x !== undefined;
  const yLabelText = soloLabel(0);
  const yRealRich = richLabelAst(yLabelText);
  const yRich = astOf(yLabelText);
  const yDrawn = !!yRealRich || off.y !== undefined || sty.y !== undefined;
  const y2LabelText = hasY2 ? soloLabel(1) : undefined;
  const y2Rich = hasY2 ? astOf(y2LabelText) : null;
  const y2Drawn = hasY2 && (!!richLabelAst(y2LabelText) || off.y2 !== undefined || sty.y2 !== undefined);
  const titleRich = richLabelAst(args.title?.trim());

  // labelSize is the px height/width uPlot reserves for the axis TITLE
  // (shared by x/y/y2 below) — must grow with `titlePx` so a bigger
  // template's title never clips against the plot area (item 2). Floored at
  // uPlot's own prior default (30) for the same never-shrink reason as
  // xAxisSize/yAxisSize below.
  const labelSize = Math.max(30, titlePx + 20);
  const axis = {
    stroke: axisColor,
    font,
    labelFont,
    labelSize,
    grid: showGrid === false ? { show: false } : { stroke: gridColor, width: 1 },
    ticks: { stroke: gridColor, width: 1 },
  };

  const plugins: uPlot.Plugin[] = [];
  if (tool === "pan") plugins.push(panPlugin());
  if (tool === "cursor") plugins.push(readoutPlugin(onReadout));
  if (tool === "measure" && args.onMeasure) {
    plugins.push(measurePlugin(args.onMeasure, cssVar("--accent") || "#8b5cf6"));
  }
  if (tool === "stats" && args.onStats) {
    plugins.push(statsPlugin(args.onStats, accentColor));
  }
  // Integrate / FWHM: when the tool is active, the plugin owns the drag AND draws
  // the committed result; otherwise a draw-only instance keeps a prior result
  // shaded across tool switches (it clears only on dataset change / chip clear).
  if (tool === "integ") {
    plugins.push(
      integratePlugin(args.integral ?? null, accentColor, accentSoftColor, {
        onIntegrate: args.onIntegrate,
        interactive: true,
      }),
    );
  } else if (args.integral) {
    plugins.push(integratePlugin(args.integral, accentColor, accentSoftColor));
  }
  if (tool === "fwhm") {
    plugins.push(
      fwhmPlugin(args.fwhmResult ?? null, accentColor, captureSoftColor, {
        onFwhm: args.onFwhm,
        interactive: true,
      }),
    );
  } else if (args.fwhmResult) {
    plugins.push(fwhmPlugin(args.fwhmResult, accentColor, captureSoftColor));
  }
  // Gadget frame (#33 fit → #34 the rest): only draws/drags while its tool is
  // active (the gadget is cleared entirely on tool switch — see PlotStage —
  // so there is no draw-only "persists across tools" branch here). Cursors
  // mode swaps the ROI band for two independent draggable lines; every other
  // mode (fit/integrate/stats/differentiate/fft) shares the same band — only
  // what the store computes from it differs.
  if (tool === "qfit") {
    if (args.gadgetMode === "cursors") {
      plugins.push(
        gadgetCursorsPlugin(args.gadgetCursors ?? null, accentColor, {
          onCursorsChange: args.onCursorsChange,
          interactive: true,
        }),
      );
    } else {
      plugins.push(
        quickFitPlugin(args.qfitRoi ?? null, accentColor, accentSoftColor, {
          onRoiChange: args.onRoiChange,
          interactive: true,
        }),
      );
    }
  }
  if (refLines && refLines.length > 0) {
    // Dragging in the non-gesture tools (pointer/zoom/cursor); pan/measure/
    // region own the pointer-drag, so reference lines stay static there.
    plugins.push(
      refLinePlugin(refLines, inkDimColor, {
        onMove: args.onRefLineMove,
        interactive: tool === "pointer" || tool === "zoom" || tool === "cursor",
      }),
    );
  }
  // Shapes (MAIN #27) register BETWEEN refLines and annotations: they draw
  // above series/ref-lines but below annotation TEXT (spec's z-order) since
  // plugin `draw` hooks paint in registration order, later = on top. Wired
  // whenever there's something to SHOW (existing shapes) or something to DO
  // (an active draw-new-shape mode, even with zero shapes so far).
  const shapeKind = args.shapeDraw?.drawKind ?? null;
  if ((args.shapes && args.shapes.length > 0) || shapeKind) {
    plugins.push(
      shapesPlugin(args.shapes ?? [], inkColor, {
        interactive: tool === "pointer" && !!args.shapeEdit,
        selectColor: accentColor,
        selectedId: args.shapeEdit?.selectedId ?? null,
        onSelect: args.shapeEdit?.onSelect,
        onMove: args.shapeEdit?.onMove,
        onReshape: args.shapeEdit?.onReshape,
        onContextMenu: args.shapeEdit?.onContextMenu,
        drawKind: shapeKind,
        onDrawCommit: args.shapeDraw?.onDrawCommit,
      }),
    );
  }
  if (annotations && annotations.length > 0) {
    plugins.push(
      annotationPlugin(annotations, inkColor, font, {
        interactive: tool === "pointer" && !!args.annotationEdit,
        selectColor: accentColor,
        selectedId: args.annotationEdit?.selectedId ?? null,
        onSelect: args.annotationEdit?.onSelect,
        onMove: args.annotationEdit?.onMove,
        onResize: args.annotationEdit?.onResize,
        onEditText: args.annotationEdit?.onEditText,
        onContextMenu: args.annotationEdit?.onContextMenu,
        onResetView: args.annotationEdit?.onResetView,
      }),
    );
  }
  if (args.regionShades && args.regionShades.length > 0) {
    plugins.push(regionShadePlugin(args.regionShades));
  }
  if (args.errorBars && args.errorBars.size > 0) {
    plugins.push(errorBarsPlugin(args.errorBars, inkDimColor));
  }
  if (args.colorByColumns && args.colorByColumns.size > 0) {
    plugins.push(colorScatterPlugin(args.colorByColumns));
  }
  if (args.axisBox) {
    plugins.push(axisBoxPlugin(inkDimColor));
  }
  // View history is pushed BEFORE wheel-zoom so its `wheel` listener on `u.over`
  // is registered first and therefore fires first: at the event target,
  // listeners run in registration order. It must capture the PRE-zoom bounds
  // as the "before" snapshot; if wheel-zoom ran first it would already have
  // mutated the scale, so Alt+Left restored a range one wheel-tick off.
  if (args.onViewChange) plugins.push(viewHistoryPlugin(args.onViewChange));
  // Wheel-to-zoom is independent of the active tool (it's a navigation aid, not a
  // drag gesture), so it composes with any tool when the pref is on.
  if (args.wheelZoom) {
    plugins.push(wheelZoomPlugin());
  }
  // Peak wizard click-on-plot marker editing (item 5): also tool-independent —
  // wizard-scoped, not toolbar-tool-scoped (see BuildOptsArgs.peakWizardEdit).
  if (args.peakWizardEdit) {
    const { markers, onAdd, onRemove } = args.peakWizardEdit;
    plugins.push(peakMarkerEditPlugin(markers, { onAdd, onRemove }));
  }
  // Anchor-point baseline editing (GOTO #2): also tool-independent —
  // workshop-scoped, not toolbar-tool-scoped (see BuildOptsArgs.anchorEdit).
  if (args.anchorEdit) {
    const { getAnchors, onAdd, onMove, onRemove } = args.anchorEdit;
    plugins.push(anchorEditPlugin(getAnchors, { onAdd, onMove, onRemove, color: accentColor }));
  }
  // Axis titles / title (GOTO #5). Push the plugin when it must DRAW a title
  // (rich or moved) or the DOM title is rich, OR — in the pointer tool — for
  // any title, so a plain unmoved title is still grab-testable to start a drag.
  const anyAxisLabel = !!(xRich || yRich || y2Rich);
  const anyDrawn = xDrawn || yDrawn || y2Drawn;
  // The plugin is needed to DRAW (rich/moved titles or a rich DOM title), or to
  // enable dragging — but only where the drag is actually wired (`axisLabelEdit`
  // present, pointer tool). Facet panels (MultiPanelStage) pass no edit bridge,
  // so plain unmoved titles there stay on uPlot's draw with no extra plugin.
  if (anyDrawn || titleRich || (tool === "pointer" && anyAxisLabel && args.axisLabelEdit)) {
    plugins.push(
      richLabelsPlugin(
        { x: xRich, y: yRich, y2: y2Rich, title: titleRich },
        { px: titlePx, family: uiFamily, color: axisColor, weight: "600" },
        args.axisLabelEdit ?? undefined,
        { x: xDrawn, y: yDrawn, y2: y2Drawn },
      ),
    );
  }

  // A static [min,max] tuple fixes the scale (Origin-style); omit it to autoscale.
  // time:false is CRITICAL — uPlot defaults the x scale to time mode, which
  // formats scientific x (Qz, 2θ, field) as dates ("12/31/69", ":00.040") and
  // renders blank for negative x (magnetometry field sweeps). These are physics
  // axes, never timestamps.
  // Non-monotonic x also breaks uPlot's y auto-range (it scans the same
  // collapsed index window), so supply full-scan extents. A range *function*
  // is only consulted when no explicit scale is pending, so box/wheel zoom and
  // a fixed yLim still win; double-click reset re-ranges back to the extents.
  const y2ScaleEff: AxisScale = args.y2Scale ?? yScale;
  const loopY = !xAscending && !yLim ? fullYExtents(payload, args.hidden, 0, isPositiveOnlyScale(yScale)) : null;
  const loopY2 = !xAscending
    ? fullYExtents(payload, args.hidden, 1, isPositiveOnlyScale(y2ScaleEff))
    : null;
  // …and its x auto-range collapses to a sliver for the same reason — scan the
  // x column for the true sweep width (a range function, so zoom/xLim still win).
  const loopX = !xAscending && !xLim
    ? fullXExtents(payload.data[0] as (number | null)[], isPositiveOnlyScale(xScale))
    : null;
  const scales: uPlot.Scales = {
    x: {
      time: xFmt?.mode === "date" || xFmt?.mode === "time" || xFmt?.mode === "datetime",
      ...scaleDistrProps(xScale),
      ...(xLim ? { range: xLim } : loopX ? { range: () => loopX } : {}),
    },
    y: {
      ...scaleDistrProps(yScale),
      ...(yLim ? { range: yLim } : loopY ? { range: () => loopY } : {}),
    },
  };
  // A categorical x-axis (gap #20) overrides a numeric xFmt: the plotted
  // x values are ordinal positions, not physical quantities, so a fixed/sci
  // number format would show "1.0"/"2.0" instead of the real category names.
  const xValues = payload.xCategories
    ? categoricalTickFormatter(payload.xCategories)
    : tickFormatter(xFmt);
  const yValues = tickFormatter(yFmt);
  // y2Fmt null/undefined inherits yFmt (compatibility default — see the
  // BuildOptsArgs doc); only build a distinct formatter when overridden.
  const y2Values = y2Fmt ? tickFormatter(y2Fmt) : yValues;
  // A FIXED range (xLim/yLim/y2Lim — an applied Origin figure or a hand-typed
  // Inspector AxisLimits value) bypasses uPlot's own rangeLog decade-snapping
  // on a log axis, so supply our own splits generator there (see
  // fixedLogAxisSplits's doc for why + the sub-decade Origin-step behaviour).
  // Autoscaled log axes use the same generator so their 2–9 subdivisions
  // match fixed Origin axes after rangeLog rounds the bounds. A
  // reciprocal axis has NO built-in uPlot locator at all (unlike log's
  // rangeLog-anchored logAxisSplits) — supply reciprocalAxisSplits
  // UNCONDITIONALLY (fixed range or autoscaled), or uPlot falls through to
  // its generic linear numAxisSplits, which spaces ticks evenly in RAW x —
  // wrong for this scale (see reciprocalAxisSplits's doc).
  const splitsFor = (
    scale: AxisScale,
    lim: [number, number] | null | undefined,
    step: number | null | undefined,
  ): uPlot.Axis.Splits | undefined => {
    if (scale === "reciprocal") {
      return (_u: uPlot, _axisIdx: number, scaleMin: number, scaleMax: number): number[] =>
        reciprocalAxisSplits(scaleMin, scaleMax);
    }
    if (scale === "linear" && lim && step != null && step > 0) {
      return (_u: uPlot, _axisIdx: number, scaleMin: number, scaleMax: number): number[] =>
        fixedLinearAxisSplits(scaleMin, scaleMax, step);
    }
    return scale === "log"
      ? (_u: uPlot, _axisIdx: number, scaleMin: number, scaleMax: number): number[] =>
          fixedLogAxisSplits(scaleMin, scaleMax, step ?? null)
      : undefined;
  };
  const xSplits = splitsFor(xScale, xLim, args.xStep);
  const ySplits = splitsFor(yScale, yLim, args.yStep);
  // Tick-area `size` (excludes the label, see uPlot's doc) scales with the
  // tick font too — x is a single text line (height-bound, uPlot's own
  // default 50 already has headroom for the +1px bump) so only a small
  // bump; y must additionally fit WIDER digit strings at the bigger font,
  // hence the larger bump (item 2's "must grow with the font" clause). The
  // `Math.max` floors both at the PRE-item-2 widths (uPlot's own 50 for x;
  // our prior flat 60 for y) so a smaller publication template (APS/Nature,
  // fontSize 9) never shrinks below what already rendered fine — this only
  // grows room for a bigger font, never takes it away.
  const xAxisSize = Math.max(50, tickPx + 42);
  // Y-axis tick-value band: MEASURE the widest formatted tick label rather than
  // assuming ~4 chars, so many-digit labels (common in Origin imports, e.g.
  // "0.000012" or "-1234.5") don't overflow the band and overlap the axis
  // title. uPlot calls this during layout with the drawn tick strings; we
  // reserve their width + a generous gap, floored at the prior fixed width so a
  // small template never shrinks below what already rendered fine.
  const yGutterFloor = Math.max(60, tickPx * 4 + 16);
  const yTickPad = tickPx + 12; // tick marks + label gap + breathing room
  const yAxisSize: uPlot.Axis["size"] = (self, values) => {
    if (!values || values.length === 0) return yGutterFloor;
    const ctx = self.ctx;
    const pxr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const prevFont = ctx.font;
    ctx.font = `${tickPx * pxr}px ${cssVar("--font-mono") || "monospace"}`;
    let maxW = 0;
    for (const v of values) {
      // Log minor splits deliberately format to null/blank. They draw grid
      // and tick marks, but must not reserve gutter width for the string
      // coercion of `null`.
      if (v == null || v === "") continue;
      maxW = Math.max(maxW, ctx.measureText(v).width);
    }
    ctx.font = prevFont;
    return Math.max(yGutterFloor, Math.ceil(maxW / pxr + yTickPad));
  };
  const axes: uPlot.Axis[] = [
    {
      ...axis,
      size: xAxisSize,
      // Blank uPlot's own draw only when the plugin draws this title (rich or
      // moved); the labelSize band stays reserved either way.
      label: xDrawn ? "" : xLabel,
      ...(xValues ? { values: xValues } : {}),
      ...(xSplits ? { splits: xSplits } : {}),
      ...(xScale === "log" ? { filter: logMajorTickFilter } : {}),
    },
    {
      ...axis,
      size: yAxisSize,
      label: yDrawn ? "" : yLabelText,
      ...(yValues ? { values: yValues } : {}),
      ...(ySplits ? { splits: ySplits } : {}),
      ...(yScale === "log" ? { filter: logMajorTickFilter } : {}),
    },
  ];
  if (hasY2) {
    const y2Lim = args.y2Lim ?? null;
    scales.y2 = {
      ...scaleDistrProps(y2ScaleEff),
      ...(y2Lim ? { range: y2Lim } : loopY2 ? { range: () => loopY2 } : {}),
    };
    const y2Splits = splitsFor(y2ScaleEff, y2Lim, args.y2Step);
    // Secondary axis on the right; hide its grid so the two grids don't overlap.
    axes.push({
      ...axis,
      scale: "y2",
      side: 1,
      size: yAxisSize,
      label: y2Drawn ? "" : y2LabelText,
      grid: { show: false },
      ...(y2Values ? { values: y2Values } : {}),
      ...(y2Splits ? { splits: y2Splits } : {}),
      ...(y2ScaleEff === "log" ? { filter: logMajorTickFilter } : {}),
    });
  }

  // Resolved stroke per display series, populated during the series build
  // below — captured here (rather than recomputed) so the post-loop band
  // resolution (`resolveFillBands`) can derive a band's fill colour from the
  // EXACT stroke its "from" series draws with, including the literal-colour
  // contrast substitution above.
  const strokes: string[] = [];
  const seriesArr: uPlot.Series[] = [
    // x series: declare its sort order so uPlot autoscales correctly. Ascending
    // (the common case: temperature/2θ/time) keeps the fast endpoint path;
    // non-monotonic x (hysteresis loops, swept-back scans) must scan all points.
    { sorted: xAscending ? 1 : 0 },
    ...payload.series.map((s, i) => {
      const style = seriesStyles?.[i];
      // Literal per-series overrides (e.g. an Origin-imported figure's
      // saved line colour) are checked for contrast against THIS window's
      // effective background and swapped for the ink token when they'd be
      // invisible (a literal black stroke on our dark canvas, or literal
      // white on a "light" override) — never mutates the stored style, so
      // a theme/background switch re-resolves live. Default palette
      // colours (`--series-N`) pass through unchanged (already
      // theme-designed for contrast; see `resolveDrawColor`'s doc).
      const stroke = resolveDrawColor(seriesColor(i, style), isDarkBg, inkColor);
      strokes[i] = stroke;
      const label = labels[i];
      const scale = (s.axis ?? 0) === 1 ? "y2" : "y";
      const show = !args.hidden?.[i]; // interactive legend visibility
      // Selected companion (#50 brush): accent, filled larger markers, no line.
      if (s.selected) {
        return { label, scale, stroke: accentColor, fill: accentColor, width: 0, points: loopPoints({ show: true, size: 7 }), show };
      }
      // Muted "excluded" companion (grey mode): faint hollow markers, no line.
      if (s.muted) {
        return { label, scale, stroke: inkDimColor, width: 0, points: loopPoints({ show: true, size: 5 }), show };
      }
      // Peak markers: points only, no connecting line.
      if (s.kind === "points") {
        return { label, scale, stroke, fill: stroke, width: 0, points: loopPoints({ show: true, size: 8 }), show };
      }
      // Colour-mapped scatter (MAIN #14): `colorScatterPlugin` (registered
      // above whenever `args.colorByColumns` is non-empty) draws every point
      // for this column itself, keyed to the z channel — so the native line
      // AND points are hidden entirely here to avoid double-drawing. No fill
      // (a fill-under/between a colour-mapped point cloud isn't meaningful).
      if (args.colorByColumns?.has(i + 1)) {
        return { label, scale, stroke, width: 0, points: { show: false }, show };
      }
      // Default trace shape (Preferences) when the series has no explicit style:
      // Scatter = markers, no line; Line + markers = both; Step = stepped line.
      const trace = args.defaultTrace ?? "Line";
      const scatter = trace === "Scatter";
      const width = style?.width ?? (scatter ? 0 : (args.baseLineWidth ?? 1.5));
      const dash = style?.line ? DASH[style.line] : undefined;
      // Optional markers. Default is a filled circle (uPlot built-in); other
      // glyphs supply a custom paths builder. Open glyphs (+/✕/✳) stroke only;
      // closed glyphs fill with the series colour.
      let points: uPlot.Series.Points = { show: false };
      if (style?.marker) {
        const size = style.markerSize ?? 5;
        const shape = style.markerShape ?? "circle";
        const paths = markerPaths(shape, size);
        points = paths
          ? { show: true, size, paths, stroke, ...(FILLED_SHAPES.has(shape) ? { fill: stroke } : {}) }
          : { show: true, size };
      } else if (scatter || trace === "Line + markers") {
        points = { show: true, size: 5 };
      }
      // Fill-under (MAIN #13): uPlot's native `series.fill`/`fillTo`, derived
      // from this series' own resolved stroke. `{vs}` band fills are NOT a
      // per-series prop — see `resolveFillBands` below (opts.bands).
      const def: uPlot.Series = {
        label, scale, stroke, width, dash, points: loopPoints(points), show,
        ...seriesFillProps(style?.fill, stroke),
      };
      // Stepped trace: apply the caller-supplied step-after path builder (there's
      // no per-series line-shape override, so it's a global default).
      if (trace === "Step" && !style?.line && args.steppedPaths) {
        def.paths = xAscending ? args.steppedPaths : fullLine(args.steppedPaths);
      } else if (!xAscending && width > 0 && args.linearPaths) {
        // Loop rendering: draw the line over every point in acquisition order.
        def.paths = fullLine(args.linearPaths);
      }
      return def;
    }),
  ];
  // Fill-between (MAIN #13): a top-level uPlot Band per series requesting
  // `fill: {vs: channel}` — see uplotFill.resolveFillBands's doc for the
  // "vs must be currently plotted" fallback.
  const bands = resolveFillBands(args.plotted ?? [], seriesStyles ?? [], (i) => strokes[i] ?? accentColor);

  return {
    width,
    height,
    ...(args.title?.trim() ? { title: args.title.trim() } : {}),
    // Box-zoom in zoom AND pointer mode (MAIN #18 — empty-canvas drag keeps
    // the muscle-memory box-zoom gesture even in the new default tool; an
    // object hit takes capture-phase priority over it, see annotationPlugin/
    // refLinePlugin); region drags an x-band without rescaling
    // (setScale:false), so setSelect can read it back; pan/cursor disable drag.
    // Pointer mode ALSO suppresses uPlot's own dashed crosshair (x/y: false)
    // — the owner's "reads as measurement mode" complaint — while every
    // other tool keeps it (uPlot's default, unset here).
    cursor: {
      drag:
        tool === "region" || tool === "select"
          ? { x: true, y: false, setScale: false, uni: 1 }
          : { x: tool === "zoom" || tool === "pointer", y: tool === "zoom" || tool === "pointer", uni: 1 },
      ...(tool === "pointer" ? { x: false, y: false } : {}),
    },
    // Region / select rubber-band: on drag end, hand the two data-x edges to the
    // matching caller. posToVal does the pixel->data mapping (linear or log x);
    // the caller orders/clamps. Guard width>0 so a click (zero-width) is ignored.
    hooks: {
      setSelect: [
        (u: uPlot): void => {
          const cb = tool === "region" ? onRegionSelect : tool === "select" ? args.onRangeSelect : null;
          if (!cb) return;
          const w = u.select.width;
          if (w <= 0) return;
          cb(u.posToVal(u.select.left, "x"), u.posToVal(u.select.left + w, "x"));
        },
      ],
    },
    plugins: plugins.map(compactPluginHooks),
    legend: { show: false },
    // Setting `scales.x.time` engages uPlot's CALENDAR-aware tick placement,
    // which snaps splits to day/month/year boundaries through `tzDate`. Left
    // unset, uPlot defaults to `ts => new Date(ts * 1e3)` and reads it with
    // LOCAL accessors — so ticks landed on local midnight while the labels
    // above render `timeZone: "UTC"` (and the Inspector literally promises
    // "(UTC)"). Placement and label must agree, or the same saved spec puts
    // its date ticks in different places in different timezones. Shifting by
    // the instant's own offset makes the local accessors read UTC fields —
    // exact (it follows DST per timestamp) and far cheaper than uPlot.tzDate,
    // which builds an Intl formatter per call.
    ...(scales.x?.time ? { tzDate: utcTzDate } : {}),
    scales,
    axes,
    series: seriesArr,
    ...(bands.length > 0 ? { bands } : {}),
  };
}
