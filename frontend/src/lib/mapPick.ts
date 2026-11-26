// Click-to-pick for the pixel-extraction location (Map gridding workshop, "pixel
// at (x, y) across maps"). The Map stage's Pick tool records where the user
// clicked; the workshop reads it into its X / Y fields.
//
// The coordinates are only well defined where the backend's extraction reads
// them: `/api/map-ops/extract` interpolates every map on ITS OWN default axes
// (`calc/map_ops._default_columns`), so a click is accepted only on a view that
// shows exactly those two columns, and refused with the reason anywhere else
// (a Q view, or other channels picked in the toolbar).
//
// Session state in a small external store, not the app store: only the lazy map
// stage and workshop read it, and it is never saved with the project.

import { useSyncExternalStore } from "react";

import type { DataStruct } from "./types";

export interface MapPick {
  x: number;
  y: number;
  /** The two axis labels the point was read on. */
  axes: [string, string];
}

let current: MapPick | null = null;
const listeners = new Set<() => void>();

export const getMapPick = (): MapPick | null => current;

export function setMapPick(pick: MapPick | null): void {
  current = pick;
  listeners.forEach((l) => l());
}

export function useMapPick(): MapPick | null {
  return useSyncExternalStore((cb) => (listeners.add(cb), () => void listeners.delete(cb)), getMapPick);
}

/** The columns the backend reads a map's X and Y from (a mirror of
 *  `calc/map_ops._default_columns`), or null when it would refuse to choose. */
export function extractionColumns(data: DataStruct): [number, number] | null {
  const labels = data.labels;
  if (labels.length < 3) return null;
  const z = labels.includes("Intensity") ? labels.indexOf("Intensity") : labels.length - 1;
  const others = labels.map((_, i) => i).filter((i) => i !== z);
  if (others.length === 2) return [others[0]!, others[1]!];
  const second = data.metadata["axis1_name"];
  if (labels.includes("2Theta") && typeof second === "string" && labels.includes(second)) {
    return [labels.indexOf("2Theta"), labels.indexOf(second)];
  }
  return null;
}

/** Why a click on the view showing channels `keys` of `mapColumns(data)` cannot
 *  fill the extraction location, or null when it can. `data` is the dataset
 *  itself (not the map's prepended-axis column set). */
export function pickProblem(data: DataStruct, keys: readonly [number, number, number]): string | null {
  const want = extractionColumns(data);
  if (!want) return "Pixel extraction cannot choose this map's axes (more than two coordinate columns), so a point cannot be picked here.";
  const shift = data.metadata["is2D"] === true ? 0 : 1;
  if (keys[0] - shift === want[0] && keys[1] - shift === want[1]) return null;
  return `Pixel extraction reads each map on ${data.labels[want[0]]} and ${data.labels[want[1]]}; switch the view to those axes to pick a point.`;
}
