// PlotSpec v2 block APPLY (GUI_INTERACTION_PLAN #12, Slice 5) — the mirror of
// plotspec2.ts's "pure capture builders" (buildDisplayBlock/buildAxesBlock):
// takes a spec's `display`/`axes` blocks and pushes them onto the LIVE store
// through its existing public actions. Kept in its OWN module (not
// useGraphBuilder) so a future macro/template replay can reuse it without
// depending on the Graph Builder hook.
//
// Takes a `StoreGet` handle (lib/exportActive.ts's own seam — "a lib
// function reads the live store without importing the store module") rather
// than `useApp` directly: testable with a plain fake getter, same idiom
// exportFigureCommand.test.ts's `fakeGet` already uses.
//
// ── ORDERING (why display applies before axes) ─────────────────────────────
// `setY2Keys(null)` (no y2 series in the display block) clears
// y2Lim/y2Scale/y2Step/y2AxisLabel as a side effect (see useApp.ts's own
// `setY2Keys`); `setY2Keys(nonEmptyArray)` does NOT. Applying the display
// block FIRST means any `axes.y2` values applied afterward always win — the
// reverse order would let a `setY2Keys(null)` wipe the y2 axis config right
// after `axes.y2` set it.
//
// ── FIELDS WITH NO STORE SETTER (silently skipped, documented once here) ──
// `AxisSpecV2.step` (x/y/y2): there is no `setXStep`/`setYStep`/`setY2Step`
// action — the store only ever derives xStep/yStep/y2Step as a side effect of
// an Origin figure decode, or clears them alongside `setXLim`/`setYLim`/
// `setY2Lim`. A restored axis limit therefore loses its captured tick step
// (falls back to auto ticks) — an accepted, documented gap, not a bug.
// (`axes.y2.fmt` now HAS a setter — `setY2Fmt` — applied like x/y.fmt below;
// a captured block always carries a real, non-null format.)
//
// ── SCOPE (blocks absent → zero effect) ─────────────────────────────────────
// A v1 spec (no `display`/`axes` content) makes zero store calls — the
// GUI_INTERACTION #12 Slice 5 regression pin (sendToStage's store-effect
// sequence for a v1 spec stays byte-identical to before this slice).

import type { StoreGet } from "./exportActive";
import type { AxesBlock, DisplayBlock, PlotSpec } from "./plotspec";
import type { SeriesStyle } from "./types";

function applyDisplayBlock(display: DisplayBlock | undefined, s: StoreGet): void {
  if (!display) return;
  const state = s();
  const currentHidden = state.hiddenChannels;
  const y2Channels: number[] = [];
  for (const [key, sd] of Object.entries(display.series ?? {})) {
    const channel = Number(key);
    if (!Number.isInteger(channel)) continue; // hand-crafted/malformed key — ignore
    // Reset first, then reconstruct from the captured fields ONLY — a full
    // restore must not merge with whatever leftover style the channel
    // happens to carry right now (see the module doc: this runs right after
    // the caller's own setActive/setXKey/setYKeys, which may or may not have
    // reset seriesStyles depending on whether the dataset switch was
    // genuine — resetSeriesStyle makes the outcome deterministic either way).
    state.resetSeriesStyle(channel);
    const patch: Partial<SeriesStyle> = {};
    if (sd.color !== undefined) patch.color = sd.color;
    if (sd.width !== undefined) patch.width = sd.width;
    if (sd.marker !== undefined) patch.marker = sd.marker;
    if (sd.markerShape !== undefined) patch.markerShape = sd.markerShape;
    if (sd.line !== undefined) patch.line = sd.line;
    if (Object.keys(patch).length > 0) state.setSeriesStyle(channel, patch);
    // toggleHidden is the only hidden-channel setter (no `setHiddenChannels`
    // action) — flip only when the captured state disagrees with the
    // current one, so an already-correct channel is left alone.
    const wantHidden = sd.hidden === true;
    if (wantHidden !== currentHidden.includes(channel)) state.toggleHidden(channel);
    if (sd.axis === 1) y2Channels.push(channel);
  }
  state.setY2Keys(y2Channels.length > 0 ? y2Channels : null);
  state.setSeriesOrder(display.order && display.order.length > 0 ? display.order : null);
}

function applyAxesBlock(axes: AxesBlock | undefined, s: StoreGet): void {
  if (!axes) return;
  const state = s();
  if (axes.title !== undefined) state.setPlotTitle(axes.title);
  if (axes.x) {
    if (axes.x.label !== undefined) state.setXAxisLabel(axes.x.label);
    if (axes.x.lim !== undefined) state.setXLim(axes.x.lim);
    if (axes.x.scale !== undefined) state.setXScale(axes.x.scale);
    if (axes.x.fmt !== undefined) state.setXFmt(axes.x.fmt);
    // axes.x.step: no setXStep action exists — see module doc.
  }
  if (axes.y) {
    if (axes.y.label !== undefined) state.setYAxisLabel(axes.y.label);
    if (axes.y.lim !== undefined) state.setYLim(axes.y.lim);
    if (axes.y.scale !== undefined) state.setYScale(axes.y.scale);
    if (axes.y.fmt !== undefined) state.setYFmt(axes.y.fmt);
    // axes.y.step: no setYStep action exists — see module doc.
  }
  if (axes.y2) {
    if (axes.y2.label !== undefined) state.setY2AxisLabel(axes.y2.label);
    if (axes.y2.lim !== undefined) state.setY2Lim(axes.y2.lim);
    if (axes.y2.scale !== undefined) state.setY2Scale(axes.y2.scale);
    if (axes.y2.fmt !== undefined) state.setY2Fmt(axes.y2.fmt);
    // axes.y2.step: no setY2Step action exists — see module doc.
  }
}

/** Apply a spec's v2 `display`/`axes` blocks onto the live store — the Slice
 *  5 counterpart of `captureLiveBlocks` (useGraphBuilder.ts's Slice 3 piece).
 *  Call AFTER the caller's own setActive/setXKey/setYKeys (the spec's
 *  dataset must already be the live one) — this only pushes STYLE/AXIS
 *  state, never zones/channel selection itself. A spec with neither block
 *  present makes zero store calls (see the module doc's regression-pin
 *  note). */
export function applySpecBlocks(spec: PlotSpec, s: StoreGet): void {
  // Display FIRST, axes SECOND — see the module doc's ORDERING note.
  applyDisplayBlock(spec.display, s);
  applyAxesBlock(spec.axes, s);
}
