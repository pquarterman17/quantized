// Frame-rect bridge (decode #52 — faithful in-frame legend placement). Origin
// legends are FRAME-anchored (a fraction of the plot's axes rect), but the DOM
// legend (`PlotLegend`) is a sibling of the uPlot canvas inside `.qzk-stage`,
// so it can't know where the frame sits until uPlot lays out — and the frame
// moves on resize AND on gutter changes (tick-label width shifts on zoom).
//
// This tiny uPlot plugin publishes the current frame rect (relative to the
// enclosing `.qzk-stage`) as CSS custom properties on that stage element, so
// `PlotLegend` positions a frame-anchored legend at `frameLeft + frameWidth*fx`
// via pure `calc()` — the browser recomputes as the vars change, with ZERO
// React re-renders on resize/zoom. No store bridge, no ref plumbing.
//
// DPR: the rect is read from `u.over.getBoundingClientRect()` — CSS pixels,
// devicePixelRatio-independent — NOT `u.bbox`, which is CANVAS pixels (× DPR)
// and would place the DOM overlay at the wrong spot on a HiDPI display (the
// same CSS-px-vs-canvas-px distinction `lib/pointGesture.ts` documents).

import type uPlot from "uplot";

/** The plot frame (`u.over`) as {left, top, width, height} in CSS px, relative
 *  to a container's own client rect. Pure: both rects come from
 *  `getBoundingClientRect()`. */
export interface FrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Frame rect relative to a container — `over` minus the container's origin.
 *  Both args are CSS-pixel rects (getBoundingClientRect), so the result is the
 *  CSS-px offset a DOM sibling needs; no DPR scaling is involved. */
export function frameRect(over: DOMRect, container: DOMRect): FrameRect {
  return {
    left: over.left - container.left,
    top: over.top - container.top,
    width: over.width,
    height: over.height,
  };
}

/** The CSS custom properties the plugin publishes on the stage element; read
 *  by `frameAnchorStyle` (and any future frame-anchored chrome). */
export const FRAME_VARS = {
  left: "--qz-frame-left",
  top: "--qz-frame-top",
  width: "--qz-frame-width",
  height: "--qz-frame-height",
} as const;

/** Inline style placing a box's TOP-LEFT at frame fraction `[fx, fy]`
 *  (fx rightward from the frame's left, fy DOWNWARD from its top — the
 *  `PlotView.legendFrameXY` convention). Pure `calc()` over the published CSS
 *  vars, so it needs no JS recompute on resize/zoom. The var fallbacks (the
 *  stage's own box) apply only for the one frame before the plugin first fires
 *  or when there is no uPlot frame at all. */
export function frameAnchorStyle([fx, fy]: [number, number]): {
  left: string;
  top: string;
  right: "auto";
  bottom: "auto";
} {
  return {
    left: `calc(var(${FRAME_VARS.left}, 0px) + var(${FRAME_VARS.width}, 100%) * ${fx})`,
    top: `calc(var(${FRAME_VARS.top}, 0px) + var(${FRAME_VARS.height}, 100%) * ${fy})`,
    right: "auto",
    bottom: "auto",
  };
}

/** Write the frame rect onto the stage element's CSS custom properties. Pure
 *  DOM side-effect; exported for unit testing with a mocked element. */
export function publishFrameVars(stage: HTMLElement, r: FrameRect): void {
  stage.style.setProperty(FRAME_VARS.left, `${r.left}px`);
  stage.style.setProperty(FRAME_VARS.top, `${r.top}px`);
  stage.style.setProperty(FRAME_VARS.width, `${r.width}px`);
  stage.style.setProperty(FRAME_VARS.height, `${r.height}px`);
}

/** uPlot plugin: on layout (ready), resize (setSize) and every redraw (draw —
 *  catches zoom/pan gutter shifts), publish the frame rect as CSS vars on the
 *  nearest `.qzk-stage` ancestor. No-op when there is no such ancestor
 *  (MultiPanel / inset / background hosts, jsdom without layout) — those never
 *  mount a frame-anchored `PlotLegend`, so nothing reads the vars. */
export function frameVarsPlugin(stageSelector = ".qzk-stage"): uPlot.Plugin {
  const publish = (u: uPlot): void => {
    const stage = u.root.closest(stageSelector);
    if (!(stage instanceof HTMLElement)) return;
    publishFrameVars(stage, frameRect(u.over.getBoundingClientRect(), stage.getBoundingClientRect()));
  };
  return { hooks: { ready: publish, setSize: publish, draw: publish } };
}
