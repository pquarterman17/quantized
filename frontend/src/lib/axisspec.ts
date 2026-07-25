// The secondary (right) Y axis, in ONE representation
// (ORIGIN_FILE_DECODE_PLAN #54, pass B — "the y2 singleton").
//
// Passes A and C removed two other kinds of parallel plot state (the three
// mutually-exclusive panel arrays; the per-window page block). This one
// removes the last: the six y2 fields (`y2Keys`/`y2Lim`/`y2Scale`/`y2Step`/
// `y2Fmt`/`y2AxisLabel`) were mirrored FOUR times —
//
//   1. the store / `PlotView` (lib/plotview.ts)  — the live single plot
//   2. `SpatialPanel` (lib/multipanel.ts)        — per decoded Origin panel,
//                                                   and as `y2Log: boolean`,
//                                                   not `y2Scale: AxisScale`
//   3. `AxesBlock.y2` (lib/plotspec2.ts)         — the portable saved spec
//   4. each EXPORT path's own re-derivation      — the actual bug surface
//
// — and axis MEMBERSHIP was expressed two incompatible ways: a `y2Keys`
// index array on the store side vs. a per-mark `axis?: 0 | 1` tag on the
// wire/render side.
//
// What this module does NOT do, deliberately: generalize CARDINALITY. There
// is still exactly one secondary axis. Native >2-Y-axis rendering stays
// specimen-gated (#54, the Graph25 discipline — don't build a mechanism no
// corpus figure proves). This is a representation fix, not an N-axis model.
//
// WHY IT IS WORTH DOING (the payoff the plan predicted): each consumer
// re-derived "which plotted channels ride the secondary axis, and what
// scale/format/label does it get" by hand. Two hand-copies drift, and both
// already had:
//
//   * `08b7066` (fixed 2026-07-18) — single-figure export flattened y2 onto
//     the primary axis.
//   * The `y2_fmt` gap this pass fixes (see `resolveSecondaryAxis`'s
//     inherit rule): the single-figure path applied the "y2Fmt null inherits
//     yFmt" rule that the SCREEN applies (lib/uplotOpts.ts's `y2Values =
//     y2Fmt ? tickFormatter(y2Fmt) : yValues`), but the spatial PAGE export
//     never did — it sent `y_fmt` and simply omitted `y2_fmt`. The backend
//     does not inherit for you (`calc/figure_y2.draw_secondary_axes` passes
//     `y_fmt` straight to `apply_tick_formats`, and `None` means "no
//     formatter"), so a page export with any non-default Y tick format
//     rendered its PRIMARY axis formatted and its SECONDARY axis in
//     matplotlib's default — while the screen showed both formatted.
//
// Both of those are the same defect shape: a rule that lives in one copy of
// a duplicated derivation. With one resolver there is one place for such a
// rule to live, so the next one cannot be half-applied.

import { scaleFromLog } from "./plotview";
import { axisFmtParam, type AxisFormat, type AxisScale } from "./types";
import type { SpatialPanel } from "./multipanel";

/** The six y2 fields as ONE value, normalized across the mirrors above.
 *
 *  Two fields carry INHERIT semantics via `null`, matching what the live
 *  plot already does on screen:
 *  - `scale: null` → use the primary Y scale (uplotOpts: `args.y2Scale ??
 *    yScale`)
 *  - `fmt: null`   → use the primary Y tick format (uplotOpts: `y2Fmt ?
 *    tickFormatter(y2Fmt) : yValues`)
 *
 *  `keys: null` and `keys: []` both mean "no secondary axis" — the resolver
 *  collapses them, so no consumer has to remember which a given producer
 *  emits. */
export interface SecondaryAxisSpec {
  keys: number[] | null;
  lim: [number, number] | null;
  scale: AxisScale | null;
  step: number | null;
  fmt: AxisFormat | null;
  label: string;
}

/** The primary Y axis's own resolved scale + tick format — the values the
 *  two inherit-on-null fields above fall back to. */
export interface PrimaryAxisContext {
  scale: AxisScale;
  fmt: AxisFormat;
}

/** A secondary axis that is actually IN PLAY: membership already intersected
 *  with the plotted channels, and both inherit rules already applied. Every
 *  field is final — a consumer renders/serializes it without re-deciding
 *  anything, which is the whole point of the pass.
 *
 *  `label: null` means "no decoded/authored title — let the backend derive
 *  one" (`calc.figure._figure_series`: a lone y2 series becomes
 *  "label (unit)"), distinct from a real empty string. */
export interface ResolvedSecondaryAxis {
  keys: number[];
  lim: [number, number] | null;
  scale: AxisScale;
  fmt: AxisFormat;
  step: number | null;
  label: string | null;
}

/** THE derivation. `plotted` is the caller's already-computed visible
 *  channel list, IN DISPLAY ORDER; the returned `keys` is its y2 subset in
 *  that same order (never the raw `spec.keys` order — a consumer that used
 *  the raw list would draw the secondary series in save order rather than
 *  display order).
 *
 *  Returns `null` — not an empty object — when no plotted channel rides the
 *  secondary axis. That single "is there a y2 at all?" answer is what every
 *  caller actually branches on (the wire fragment, the minor-tick flag, the
 *  `gateY2Overrides` gate), so making it one nullable value stops each of
 *  them inventing its own `y2Plotted.length > 0` test. */
export function resolveSecondaryAxis(
  plotted: readonly number[],
  spec: SecondaryAxisSpec,
  primary: PrimaryAxisContext,
): ResolvedSecondaryAxis | null {
  const member = new Set(spec.keys ?? []);
  const keys = plotted.filter((ch) => member.has(ch));
  if (keys.length === 0) return null;
  const label = spec.label.trim();
  return {
    keys,
    lim: spec.lim,
    scale: spec.scale ?? primary.scale,
    fmt: spec.fmt ?? primary.fmt,
    step: spec.step,
    label: label || null,
  };
}

/** True when the resolved secondary axis is log — the third term of every
 *  "does this figure need minor ticks?" test. Folded in here so the two
 *  export paths stop spelling it differently (`(st.y2Scale ?? st.yScale) ===
 *  "log"` vs. a bare `panel.y2Log`). */
export function secondaryAxisIsLog(axis: ResolvedSecondaryAxis | null): boolean {
  return axis !== null && axis.scale === "log";
}

/** The `y2_*` request fields for `/api/export/figure` and the per-panel
 *  payload of `/api/export/figure-page` — the ONE place the wire shape is
 *  written. Spreads to `{}` when there is no secondary axis, so a caller
 *  writes `...secondaryAxisWire(axis)` unconditionally.
 *
 *  `y2_fmt` is always sent when a secondary axis exists, carrying the
 *  already-inherited format (see the module doc: the backend has no inherit
 *  rule of its own). `y2_label` is omitted rather than blanked so the
 *  backend's own auto-derivation still runs. */
export function secondaryAxisWire(axis: ResolvedSecondaryAxis | null): {
  y2_keys?: number[];
  y2_label?: string;
  y2_scale?: AxisScale;
  y2_fmt?: ReturnType<typeof axisFmtParam>;
  y2_step?: number | null;
} {
  if (axis === null) return {};
  return {
    y2_keys: axis.keys,
    ...(axis.label === null ? {} : { y2_label: axis.label }),
    y2_scale: axis.scale,
    y2_fmt: axisFmtParam(axis.fmt),
    y2_step: axis.step,
  };
}

/** Mirror 1 → the shared spec: the live store / a window's `PlotView`.
 *  Structurally typed (not `PlotView` itself) so the store's own state
 *  object, a restored window view, and a test fixture all satisfy it
 *  without importing the full 40-field interface. */
export function secondaryAxisFromView(view: {
  y2Keys: number[] | null;
  y2Lim: [number, number] | null;
  y2Scale: AxisScale | null;
  y2Step: number | null;
  y2Fmt: AxisFormat | null;
  y2AxisLabel: string;
}): SecondaryAxisSpec {
  return {
    keys: view.y2Keys,
    lim: view.y2Lim,
    scale: view.y2Scale,
    step: view.y2Step,
    fmt: view.y2Fmt,
    label: view.y2AxisLabel,
  };
}

/** Mirror 2 → the shared spec: one decoded Origin `SpatialPanel`.
 *
 *  Two shape differences this adapter absorbs, so no consumer sees them:
 *  - the panel stores `y2Log: boolean | null` (Origin decodes a log FLAG,
 *    it has no reciprocal concept) rather than an `AxisScale`. Bridged with
 *    `scaleFromLog`, exactly as `useMultiPanelStage` already does for the
 *    on-screen render — so screen and export now agree by construction
 *    instead of by two hand-written conversions.
 *  - the panel has NO y2 tick-format field at all, so `fmt` is `null` =
 *    inherit the page's primary Y format. That is what the screen has always
 *    done for these panels; the page export used to drop it. */
export function secondaryAxisFromPanel(panel: SpatialPanel): SecondaryAxisSpec {
  return {
    keys: panel.y2Keys ?? null,
    lim: panel.y2Lim ?? null,
    scale: panel.y2Log == null ? null : scaleFromLog(panel.y2Log),
    step: panel.y2Step ?? null,
    fmt: null,
    label: panel.y2AxisLabel ?? "",
  };
}
