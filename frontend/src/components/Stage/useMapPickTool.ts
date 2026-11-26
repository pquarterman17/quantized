// The map's Pick tool: arm it, click the map, and the clicked data point becomes
// the pixel-extraction location in the Map gridding workshop (lib/mapPick.ts).
// A plain click, no drag; a drag is ignored. It owns the canvas gestures while
// armed, like the Box / ruler / wedge tools (mapToolArming.ts), so it is
// mutually exclusive with them. Where the coordinates are not well defined (a Q
// view, other channels) the click is refused with the reason in the status line
// and nothing is picked.

import { useRef, useState } from "react";

import { mapAxesOf } from "../../lib/mapBoxSpace";
import type { MapPayload } from "../../lib/mapdataFetch";
import { pickProblem, setMapPick } from "../../lib/mapPick";
import type { DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { hitTest } from "./mapRender";

export type PickMode = "off" | "pick";

export interface UseMapPickToolState {
  mode: PickMode;
  setMode: (m: PickMode) => void;
  cursor: string;
  onDown: (payload: MapPayload, w: number, h: number, px: [number, number]) => void;
  onMove: (payload: MapPayload, w: number, h: number, px: [number, number]) => void;
  onUp: (px: [number, number]) => void;
}

const fmt = (v: number): string => String(Number(v.toPrecision(6)));

/** `dataset` is the dataset itself; `mapData` its column set as the map shows it
 *  (`mapColumns`), which `keys` index. */
export function useMapPickTool(
  dataset: DataStruct | null,
  mapData: DataStruct | null,
  keys: readonly [number, number, number],
): UseMapPickToolState {
  const setStatus = useApp((s) => s.setStatus);
  const [mode, setMode] = useState<PickMode>("off");
  const down = useRef<{ payload: MapPayload; w: number; h: number; px: [number, number] } | null>(null);

  return {
    mode,
    setMode,
    cursor: "crosshair",
    onDown: (payload, w, h, px) => {
      down.current = { payload, w, h, px };
    },
    onMove: () => undefined,
    onUp: (px) => {
      const d = down.current;
      down.current = null;
      if (!d || !dataset || !mapData || Math.hypot(px[0] - d.px[0], px[1] - d.px[1]) >= 3) return;
      const hit = hitTest(d.payload, d.w, d.h, d.px[0], d.px[1]);
      if (!hit) return;
      const problem = pickProblem(dataset, keys);
      const axes = mapAxesOf(mapData.labels, keys);
      if (problem || !axes) {
        setStatus(problem ?? "Pick point: this view's axes are unavailable.", "danger");
        return;
      }
      setMapPick({ x: hit.x, y: hit.y, axes });
      setStatus(`Picked (${fmt(hit.x)}, ${fmt(hit.y)}) for pixel extraction`);
    },
  };
}
