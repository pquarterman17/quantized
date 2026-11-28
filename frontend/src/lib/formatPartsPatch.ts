// Apply ONLY the ticked parts of a graph format to a graph (plan item 42).
//
// The whole-format patch (`graphFormatPatch`) stays the one place that knows how
// a format lands on a view (axis breaks kept, Y3+ assignment, orphans); this
// module runs it and keeps what the ticked parts own (`lib/formatParts.ts`),
// field by field: a whole `PlotView` field, the owned keys of a tick format, the
// owned keys of each curve's style. Everything else on the target is untouched.
//
// CURVE COUNTS: styles map by plotted POSITION and STOP at the shorter side. A
// target curve past the format's last position keeps its own style; a format
// position past the target's last curve is not used. (Cycling would paint a
// one-curve source onto every curve of the target.) The result counts both.
//
// Pure.

import { axisFmtKeys, seriesKeys, wholeViewKeys, BACKGROUND_PART, type PartSet } from "./formatParts";
import { graphFormatPatch, type GraphFormat } from "./graphFormat";
import type { FormatExtraViewKey } from "./graphFormatExtras";
import type { PlotBg, PlotView } from "./plotview";
import type { AxisFormat, SeriesStyle } from "./types";

/** The target graph: its live view. */
export type PartsTarget = Pick<PlotView, "xFmt" | "yFmt" | "y2Fmt" | "seriesStyles"> & Partial<Pick<PlotView, "yAxes" | "yAxisOf" | "y2Keys">>;

export interface PartsResult {
  /** The view fields to write. Only fields a ticked part owns, so {} when nothing applies. */
  patch: Partial<PlotView>;
  /** The page background to set on the window, when the background part is ticked and the format has one. */
  bg?: PlotBg;
  /** Curves restyled by position / target curves past the format's last position (keep their own style). */
  styled: number;
  unmapped: number;
}

type Bag = Record<string, unknown>;

const AXES = ["x", "y", "y2"] as const;

/** `current` with the `keys` taken from `source` (a key `source` lacks is removed). */
function withKeys<T extends object>(current: T, source: Partial<T>, keys: readonly string[]): T {
  const out: Bag = { ...(current as Bag) };
  for (const k of keys) {
    const v = (source as Bag)[k];
    if (v === undefined) delete out[k];
    else out[k] = structuredClone(v);
  }
  return out as T;
}

function fmtPatch(parts: PartSet, full: Partial<PlotView>, current: PartsTarget): Partial<PlotView> {
  const out: Bag = {};
  for (const axis of AXES) {
    const keys = axisFmtKeys(parts, axis);
    if (keys.length === 0) continue;
    const field = `${axis}Fmt` as const;
    // A Y2 that inherits Y's format (null) has no look of its own to paste: a target Y2 of its own takes Y's.
    const srcRaw = full[field] as AxisFormat | null | undefined;
    const curRaw = current[field] as AxisFormat | null;
    const src = srcRaw ?? (axis === "y2" && curRaw ? full.yFmt : null);
    if (!src) continue;
    // A target Y2 that inherits Y gets its own copy of Y's format (never Y's breaks) with the ticked keys replaced.
    const base = curRaw ?? withKeys(current.yFmt, {}, ["breaks"]);
    out[field] = withKeys(base, src, keys);
  }
  return out as Partial<PlotView>;
}

/** `style` reduced to the keys the ticked parts own (a theme seeding a new graph); null when none is set. */
export function filterSeriesStyle(style: SeriesStyle | null, parts: PartSet): SeriesStyle | null {
  if (!style) return null;
  const keys = seriesKeys(parts) as string[];
  const out = Object.fromEntries(Object.entries(style).filter(([k]) => keys.includes(k))) as SeriesStyle;
  return Object.keys(out).length > 0 ? out : null;
}

function seriesPatch(format: GraphFormat, parts: PartSet, plotted: readonly number[], current: PartsTarget): { styles?: Record<number, SeriesStyle>; styled: number; unmapped: number } {
  const keys = seriesKeys(parts);
  if (keys.length === 0) return { styled: 0, unmapped: 0 };
  const styles: Record<number, SeriesStyle> = { ...current.seriesStyles };
  let styled = 0;
  plotted.forEach((ch, position) => {
    if (position >= format.series.length) return;
    styled++;
    const next = withKeys<SeriesStyle>(styles[ch] ?? {}, format.series[position] ?? {}, keys);
    if (Object.keys(next).length > 0) styles[ch] = next;
    else delete styles[ch];
  });
  return { styles, styled, unmapped: plotted.length - styled };
}

/** What pasting `format` onto a graph (plotted channels `plotted`, live view `current`) changes, for `parts` only. */
export function formatPartsPatch(format: GraphFormat, parts: PartSet, plotted: readonly number[], current: PartsTarget): PartsResult {
  const full = graphFormatPatch(format, plotted, current.seriesStyles, current);
  const extras: Partial<Pick<PlotView, FormatExtraViewKey>> = format.extras ? { ...format.extras } : {};
  delete (extras as Bag).bg;
  const source: Bag = { ...full, ...extras };
  const patch: Bag = {};
  // Whole fields. A field the format does not carry (no extras, no gradient, no Y3+ axes) leaves the target's alone.
  for (const k of wholeViewKeys(parts)) if (k in source) patch[k] = structuredClone(source[k]);
  Object.assign(patch, fmtPatch(parts, full, current));
  const series = seriesPatch(format, parts, plotted, current);
  if (series.styles) patch.seriesStyles = series.styles;
  const bg = parts.has(BACKGROUND_PART) ? format.extras?.bg : undefined;
  return { patch: patch as Partial<PlotView>, ...(bg ? { bg } : {}), styled: series.styled, unmapped: series.unmapped };
}
