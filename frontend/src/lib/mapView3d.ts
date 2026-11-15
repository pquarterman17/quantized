// The map's static 3-D view: which of the server-rendered 3-D marks (surface,
// scatter, waterfall) the Map stage shows INSTEAD of the 2-D canvas, from which
// angle, and how the z axis reads. A user decision, so it lives in the durable
// per-dataset map view (`lib/mapView.ts`: `.dwk`, undo) and rides along in a
// saved figure (recipe). Absent = the 2-D map. Static only: the picture is a
// matplotlib render (`/api/export/map-figure`), and the export is the SAME
// request with another format -- see `components/Stage/map3dRequest.ts`.
//
// EAGER module (the store reaches it): keep it tiny; the editing panel and the
// preview are lazy chunks.

export const MAP3D_KINDS = ["surface", "scatter3d", "waterfall"] as const;
export type Map3dKind = (typeof MAP3D_KINDS)[number];

export interface Map3dView {
  kind: Map3dKind;
  /** Elevation, degrees, -90..90 (the route refuses anything else). */
  elev: number;
  /** Azimuth, degrees, -360..360. */
  azim: number;
  /** z-axis label / unit; blank = the dataset channel's own. */
  zLabel: string;
  zUnit: string;
  /** Figure style preset and title (the export carries the same). */
  style: string;
  title: string;
}

export const DEFAULT_MAP3D: Map3dView = { kind: "surface", elev: 30, azim: -60, zLabel: "", zUnit: "", style: "default", title: "" };

const clamp = (v: unknown, lim: number, d: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : d;
const str = (v: unknown, d: string): string => (typeof v === "string" ? v.slice(0, 80) : d);

/** Read a stored 3-D view: an unknown kind is no view (undefined, the 2-D map);
 *  out-of-range angles clamp; text is capped. Never throws. */
export function sanitizeMap3d(raw: unknown): Map3dView | undefined {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const kind = MAP3D_KINDS.find((k) => k === o.kind);
  if (!kind) return undefined;
  const d = DEFAULT_MAP3D;
  return {
    kind, elev: clamp(o.elev, 90, d.elev), azim: clamp(o.azim, 360, d.azim),
    zLabel: str(o.zLabel, ""), zUnit: str(o.zUnit, ""), style: str(o.style, d.style) || d.style, title: str(o.title, ""),
  };
}

export function sameMap3d(a: Map3dView | undefined, b: Map3dView | undefined): boolean {
  return a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));
}
