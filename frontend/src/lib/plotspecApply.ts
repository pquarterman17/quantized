// PlotSpec v2 block APPLY (GUI_INTERACTION_PLAN #12, Slice 5 + "part C") —
// the mirror of plotspec2.ts's "pure capture builders" (buildDisplayBlock/
// buildAxesBlock/buildDecorBlock): takes a spec's `display`/`axes`/`decor`
// blocks and pushes them onto the LIVE store through its existing public
// actions. Kept in its OWN module (not useGraphBuilder) so a future macro/
// template replay can reuse it without depending on the Graph Builder hook.
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
// after `axes.y2` set it. `decor` applies LAST (see below) — it never
// interacts with display/axes' setters, so its position relative to them is
// arbitrary; last simply mirrors the field order on `PlotSpec` itself.
//
// ── FIELDS WITH NO STORE SETTER (silently skipped, documented once here) ──
// `AxisSpecV2.step` (x/y/y2): there is no `setXStep`/`setYStep`/`setY2Step`
// action — the store only ever derives xStep/yStep/y2Step as a side effect of
// an Origin figure decode, or clears them alongside `setXLim`/`setYLim`/
// `setY2Lim`. A restored axis limit therefore loses its captured tick step
// (falls back to auto ticks) — an accepted, documented gap, not a bug.
// (`axes.y2.fmt` now HAS a setter — `setY2Fmt` — applied like x/y.fmt below;
// a captured block always carries a real, non-null format.)
// `decor.legend.title`: no `setLegendTitle` action exists at all —
// `legendTitle` is only ever written by `applyOriginFigure`'s own direct
// `set()` call. Captured (see `LegendBlock`'s doc) but never pushed here —
// same documented-gap category as `step` above.
// `decor.annotations[].axis` (a y2-plotted annotation): NEITHER
// `addAnnotation` nor `updateAnnotation`'s patch type accepts it — silently
// dropped on restore. Annotations pinned to the secondary axis are a
// decode-only shape (`originFigureAnnotations`) a hand-built Graph Builder
// plot never produces, so this narrows the same way `legendFrameXY`'s
// exclusion does (see `LegendBlock`'s doc).
//
// ── SCOPE (blocks absent → zero effect) ─────────────────────────────────────
// A v1 spec (no `display`/`axes`/`decor` content) makes zero store calls —
// the GUI_INTERACTION #12 Slice 5 regression pin (sendToStage's store-effect
// sequence for a v1 spec stays byte-identical to before this slice) extends
// to `decor` unchanged.
//
// ── DECOR REPLACE SEMANTICS ─────────────────────────────────────────────────
// `decor.annotations`/`decor.shapes` describe the plot's COMPLETE overlay
// list (see `buildDecorBlock`'s doc — both are global, uncoped captures),
// so applying either REPLACES whatever's live: `shapes` has a real bulk
// `clearShapes` action to reuse; `annotations` has none (`ShapesSlice` grew
// one where `store/useApp.ts`'s own annotation actions never did), so it's
// cleared via a loop of the existing per-id `removeAnnotation` instead —
// "clear+add via existing actions", never a new store action (this module
// stays action-only, no `useApp.ts` edits).

import type { StoreGet } from "./exportActive";
import type { AxesBlock, DecorBlock, DisplayBlock, PageBlock, PlotSpec } from "./plotspec";
import type { Annotation, SeriesStyle } from "./types";

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

function applyDecorBlock(decor: DecorBlock | undefined, s: StoreGet): void {
  if (!decor) return;
  const state = s();
  // REPLACE: clear every LIVE annotation first (no bulk action exists — see
  // the module doc's DECOR REPLACE SEMANTICS note), then re-add from the
  // captured block. Reads `state.annotations` once, before any removal —
  // each `removeAnnotation` call re-filters the store's live array itself,
  // so a stale snapshot of WHICH ids to remove is all this loop needs.
  if (decor.annotations !== undefined) {
    for (const a of state.annotations) state.removeAnnotation(a.id);
    for (const a of decor.annotations) {
      const id = state.addAnnotation(a.x, a.y, a.text);
      const patch: Partial<Pick<Annotation, "size" | "anchor" | "frame">> = {};
      if (a.size !== undefined) patch.size = a.size;
      if (a.anchor !== undefined) patch.anchor = a.anchor;
      if (a.frame !== undefined) patch.frame = a.frame;
      if (Object.keys(patch).length > 0) state.updateAnnotation(id, patch);
      // a.axis: no setter accepts it anywhere — see module doc.
    }
  }
  // REPLACE: `clearShapes` is a real bulk action (unlike annotations) —
  // reuse it directly, then re-add every captured shape via `addShape`,
  // which (unlike `addAnnotation`) already accepts the FULL shape payload.
  if (decor.shapes !== undefined) {
    state.clearShapes();
    for (const sh of decor.shapes) {
      state.addShape({
        kind: sh.kind,
        x1: sh.x1,
        y1: sh.y1,
        x2: sh.x2,
        y2: sh.y2,
        ...(sh.anchor !== undefined ? { anchor: sh.anchor } : {}),
        ...(sh.stroke !== undefined ? { stroke: sh.stroke } : {}),
        ...(sh.fill !== undefined ? { fill: sh.fill } : {}),
        ...(sh.opacity !== undefined ? { opacity: sh.opacity } : {}),
        ...(sh.width !== undefined ? { width: sh.width } : {}),
        ...(sh.dash !== undefined ? { dash: sh.dash } : {}),
      });
    }
  }
  if (decor.legend) {
    if (decor.legend.pos !== undefined) state.setLegendPos(decor.legend.pos);
    if (decor.legend.xy !== undefined) state.setLegendXY(decor.legend.xy);
    // decor.legend.title: no setLegendTitle action exists — see module doc.
  }
}

function applyPageBlock(page: PageBlock | undefined, s: StoreGet): void {
  if (!page) return;
  const state = s();
  // `setStackMode` CLEARS the composition (see store/useApp.ts) — harmless
  // here because a caller that wants a facet arrangement calls
  // `facetByColumn` AFTER `applySpecBlocks` (useGraphBuilder's send path),
  // and that rebuilds the composition and re-sets stackMode itself.
  if (page.stack !== undefined) state.setStackMode(page.stack);
  if (page.fit !== undefined) state.setPanelFit(page.fit);
  if (page.setup !== undefined) state.setPageSetup(page.setup);
}

/** Apply a spec's v2 `display`/`axes`/`page`/`decor` blocks onto the live
 *  store — the Slice 5 / "part C" / #54-pass-C counterpart of
 *  `captureLiveBlocks` (useGraphBuilder.ts's Slice 3 piece). Call AFTER the
 *  caller's own setActive/setXKey/setYKeys (the spec's dataset must already
 *  be the live one) — this only pushes STYLE/AXIS/OVERLAY/PAGE state, never
 *  zones/channel selection itself. A spec with none of the four blocks
 *  present makes zero store calls (see the module doc's regression-pin
 *  note). */
export function applySpecBlocks(spec: PlotSpec, s: StoreGet): void {
  // Display FIRST, axes SECOND — see the module doc's ORDERING note. Decor
  // and page are independent of both — see the same note for why their
  // position doesn't matter functionally.
  applyDisplayBlock(spec.display, s);
  applyAxesBlock(spec.axes, s);
  applyPageBlock(spec.page, s);
  applyDecorBlock(spec.decor, s);
}
