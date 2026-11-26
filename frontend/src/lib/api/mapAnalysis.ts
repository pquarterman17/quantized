// `/api/map-analysis/{peaks,volume}` (calc/map_peaks, calc/map_volume): each
// returns a small table DataStruct whose metadata carries the full result.
// Its only consumer is the lazy Map analysis workshop; NOT re-exported by lib/api.ts.

import { postJSON } from "./http";
import type { DataStruct } from "../types";

interface MapColumns {
  dataset: DataStruct;
  x_col?: number;
  y_col?: number;
  z_col?: number;
}

export interface MapPeaksRequest extends MapColumns {
  n_peaks?: number | null;
  threshold?: number;
  min_separation?: number;
  model?: "gaussian" | "lorentzian";
  rotate?: boolean;
  smooth_sigma?: number;
  fit_window?: number;
}

export type MapRegion =
  | { kind: "rect"; x0: number; x1: number; y0: number; y1: number }
  | { kind: "polygon"; points: [number, number][] };

export type MapBackground = { kind: "none" } | { kind: "constant"; value?: number } | { kind: "plane" };

export interface MapVolumeRequest extends MapColumns {
  region: MapRegion;
  background?: MapBackground;
  border?: number;
  on_nan?: "refuse" | "skip";
  /** Integration rule: every pixel a full cell (default) or Origin's integ2 trapezoid rule. */
  rule?: "pixel" | "trapezoid";
}

export const mapPeaks = (body: MapPeaksRequest, signal?: AbortSignal): Promise<DataStruct> =>
  postJSON("/api/map-analysis/peaks", body, signal);

export const mapVolume = (body: MapVolumeRequest, signal?: AbortSignal): Promise<DataStruct> =>
  postJSON("/api/map-analysis/volume", body, signal);
