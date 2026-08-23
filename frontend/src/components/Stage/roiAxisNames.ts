// Human names for the ROI/ruler commit bar's two collapse axes.
//
// The bar's preview toggle and its two integrate buttons read "x" and "y" —
// the CODE's collapse axis, not the user's data. On a reciprocal-space map
// that left someone looking at axes titled "2Theta (deg)" and "Omega (deg)"
// guessing which of "∫x"/"∫y" produced which profile. Reported from a real
// session: "the control inputs were x and y, not the actual axes of the data".
//
// Two frames need naming here, and they are NOT the same frame:
//
//   * The BOX is axis-aligned (`boxProfileLocal` gets no `angle`), so its
//     collapse axes ARE the map's displayed axes — named straight off the
//     payload, and composed exactly the way `mapRender.ts` composes the canvas
//     axis titles so the bar and the axis agree word for word.
//
//   * The RULER integrates in its own ROTATED frame (`useMapRuler` passes
//     `angle: ruler.angle`, and `rulerToRect` puts local x along the ruler's
//     LENGTH, local y across its WIDTH). Naming those after the data axes
//     would be wrong at every angle but zero, so they stay "along"/"across"
//     with the angle spelled out in the tooltip.
//
// Pure (no React/DOM), like `roiBarLayout.ts` beside it — the presentation
// question ("what do we call this axis?") is separable from the JSX, and it is
// the part worth unit-testing.

import type { MapPayload } from "../../lib/mapdataFetch";

/** Longest name the toggle can show. The bar is a fixed 216 px (see
 *  `roiBarLayout.BAR_W` / `.qzk-roi-bar`), and its header row also carries the
 *  "preview" label and the ✕ remove, which leaves roughly 44 px of text per
 *  toggle button at `--font-size-sm` — about six characters. Longer names
 *  ellipsize here and appear in full in the tooltip. `.qzk-roi-axis-toggle
 *  button` carries a CSS max-width too, so a pathological label still cannot
 *  break the layout if this ever drifts. */
const MAX_NAME = 6;

/** Button-sized axis name: the label, ellipsized, or `fallback` when the
 *  payload has no label at all (a channel with an empty `labels[i]`). */
export function shortAxisName(label: string, fallback: string): string {
  const s = label.trim() || fallback;
  return s.length > MAX_NAME ? `${s.slice(0, MAX_NAME - 1)}…` : s;
}

/** "Qx (1/Å)" — the same label+unit composition `mapRender.ts` paints as the
 *  canvas axis title, so the bar names an axis the way the axis names itself. */
export function axisTitle(label: string, unit: string, fallback: string): string {
  const name = label.trim() || fallback;
  return unit.trim() ? `${name} (${unit})` : name;
}

export interface CollapseAxis {
  /** Toggle / ∫-button text — short enough to fit the bar. */
  name: string;
  /** Full noun phrase for tooltips ("Qx (1/Å)", "the ruler's length (30°
   *  from Qx)"). */
  full: string;
  /** The axis this profile sums AWAY, as the same kind of noun phrase. */
  over: string;
}

export interface CollapseAxes {
  x: CollapseAxis;
  y: CollapseAxis;
}

/** Collapse-axis names for the axis-aligned box: the map's own axes. */
export function boxAxes(p: MapPayload): CollapseAxes {
  const x = axisTitle(p.xLabel, p.xUnit, "x");
  const y = axisTitle(p.yLabel, p.yUnit, "y");
  return {
    x: { name: shortAxisName(p.xLabel, "x"), full: x, over: y },
    y: { name: shortAxisName(p.yLabel, "y"), full: y, over: x },
  };
}

/** Collapse-axis names for the cut ruler's ROTATED frame. Deliberately NOT the
 *  data axes — see the module header. The angle is quoted against the map's x
 *  axis by name, which is the only part of the data frame that still means
 *  something once the ruler is turned. */
export function rulerAxes(p: MapPayload, angleDeg: number): CollapseAxes {
  const from = (p.xLabel.trim() || "x");
  const length = `the ruler's length (${Math.round(angleDeg * 10) / 10}° from ${from})`;
  const width = "the ruler's width";
  return {
    x: { name: "along", full: length, over: "its width" },
    y: { name: "across", full: width, over: "its length" },
  };
}

/** Tooltip for the preview toggle — the sparkline is client-side and never
 *  landed (see `roiMath.ts`), so it says "preview", not "integrate". */
export function previewTitle(a: CollapseAxis): string {
  return `Preview the profile onto ${a.full}, summing over ${a.over}`;
}

/** Tooltip for an ∫ button — this one DOES hit the backend and land. */
export function integrateTitle(a: CollapseAxis): string {
  return `Integrate onto ${a.full}, summing over ${a.over} — lands as a new dataset`;
}
