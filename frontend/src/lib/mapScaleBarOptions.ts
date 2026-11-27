// The 2-D map's scale-bar option and its sanitizer, apart from the rules in
// mapScaleBar.ts so the eager map-view reader (lib/mapView.ts) reaches only this.

export const SCALE_BAR_CORNERS = ["bl", "br", "tl", "tr"] as const;
export type ScaleBarCorner = (typeof SCALE_BAR_CORNERS)[number];

/** The map's scale bar (`MapViewState.scaleBar`), in the map's X data units. Absent = none. */
export interface MapScaleBar {
  /** Bar length in X data units; absent = a round number near 20 % of the axis. */
  length?: number;
  /** Text under the bar; absent = the length with the axis unit ("200 nm"). */
  label?: string;
  corner: ScaleBarCorner;
  color: string;
}

export const DEFAULT_SCALE_BAR: MapScaleBar = { corner: "br", color: "#ffffff" };

/** `views` with every stored scale bar cleaned (`scaleBarField`): the one read boundary, applied by
 *  `lib/workspace.ts` after the map-view sanitizer, which keeps the object as it found it. */
export const cleanScaleBars = <V extends { scaleBar?: MapScaleBar }>(views: Readonly<Record<string, V>>): Record<string, V> =>
  Object.fromEntries(Object.entries(views).map(([id, v]) => [id, v.scaleBar ? { ...v, ...scaleBarField(v.scaleBar) } : v]));

/** `{ scaleBar }` for a spread into a map view, or nothing when the stored option is not an object. */
export const scaleBarField = (raw: unknown): { scaleBar?: MapScaleBar } => {
  if (typeof raw !== "object" || raw === null) return {};
  const { length: n, label, corner, color } = raw as Record<string, unknown>;
  return {
    scaleBar: {
      ...(typeof n === "number" && n > 0 && n < Infinity ? { length: n } : {}),
      ...(typeof label === "string" && label ? { label: label.slice(0, 80) } : {}),
      corner: SCALE_BAR_CORNERS.find((c) => c === corner) ?? DEFAULT_SCALE_BAR.corner,
      color: typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_SCALE_BAR.color,
    },
  };
};
