// The map's 3-D view: which 3-D mark (surface, scatter, waterfall) the Map
// stage shows INSTEAD of the 2-D canvas, from which angle and zoom, and how the
// z axis reads. A user decision, so it lives in the durable per-dataset map
// view (`lib/mapView.ts`: `.dwk`, undo) and rides along in a saved figure
// (recipe). Absent = the 2-D map. On screen it is the interactive canvas
// (`components/Stage/Map3D/`, whose settled rotation and zoom are written
// here) or the server render; the export is the matplotlib render
// (`/api/export/map-figure`) of the SAME camera -- see
// `components/Stage/map3dRequest.ts`.
//
// EAGER module (the store reaches it): keep it tiny; the editing panel and the
// preview are lazy chunks.

export const MAP3D_KINDS = ["surface", "scatter3d", "waterfall", "bars3d", "vectors3d"] as const;
export type Map3dKind = (typeof MAP3D_KINDS)[number];

export interface Map3dView {
  kind: Map3dKind;
  /** Elevation, degrees, -90..90 (the route refuses anything else). */
  elev: number;
  /** Azimuth, degrees, -360..360. */
  azim: number;
  /** Magnification, 0.5..3 (`lib/project3d.ts` ZOOM_RANGE); the export draws it too. */
  zoom: number;
  /** 3-D scatter: a faint line from each point down to the floor. */
  dropLines: boolean;
  /** z-axis label / unit; blank = the dataset channel's own. */
  zLabel: string;
  zUnit: string;
  /** Figure style preset and title (the export carries the same). */
  style: string;
  title: string;
  /** Options of the bar and vector kinds (width, colour columns, ...): kept as plain
   *  values here and read, clamped, by `Stage/map3dExt.ts` where they are used. */
  ext?: Record<string, number | string | boolean>;
}

/** The figure styles a stored view may name (mirrors `FIGURE_STYLES`; pinned equal
 *  by `mapView3d.test.ts`). An unknown name would render a 422 and show the
 *  panel's first option instead of the stored value. */
export const MAP3D_STYLES: readonly string[] = ["default", "aps", "nature", "thesis", "report", "web", "presentation", "poster"];

export const DEFAULT_MAP3D: Map3dView = { kind: "surface", elev: 30, azim: -60, zoom: 1, dropLines: false, zLabel: "", zUnit: "", style: "default", title: "" };

const clamp = (v: unknown, lim: number, d: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : d;
const str = (v: unknown, d: string): string => (typeof v === "string" ? v.slice(0, 80) : d);

/** Read a stored 3-D view: an unknown kind is no view (undefined, the 2-D map);
 *  out-of-range angles clamp; text is capped. Never throws. */
const extOf = (v: unknown): Map3dView["ext"] => {
  const e = Object.entries(typeof v === "object" && v !== null ? v : {}).filter(
    ([k, x]) => k.length < 12 && (typeof x === "boolean" || (typeof x === "number" && Number.isFinite(x)) || (typeof x === "string" && x.length < 12)),
  );
  return e.length ? Object.fromEntries(e.slice(0, 12)) : undefined;
};

export function sanitizeMap3d(raw: unknown): Map3dView | undefined {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const kind = MAP3D_KINDS.find((k) => k === o.kind);
  if (!kind) return undefined;
  const d = DEFAULT_MAP3D;
  return {
    kind, elev: clamp(o.elev, 90, d.elev), azim: clamp(o.azim, 360, d.azim),
    zoom: Math.min(3, Math.max(0.5, clamp(o.zoom, 3, 1))), dropLines: o.dropLines === true,
    zLabel: str(o.zLabel, ""), zUnit: str(o.zUnit, ""), style: MAP3D_STYLES.find((s) => s === o.style) ?? d.style, title: str(o.title, ""),
    ...(extOf(o.ext) ? { ext: extOf(o.ext) } : {}),
  };
}

export function sameMap3d(a: Map3dView | undefined, b: Map3dView | undefined): boolean {
  return a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));
}
