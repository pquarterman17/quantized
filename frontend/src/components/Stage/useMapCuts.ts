// State + actions for the map cut tool (ORIGIN_GAP_PLAN #18/#46): arm an
// H/V/segment cut mode, fire the backend cut, land the result in the library
// as a normal 1-D dataset (addDataset switches the stage to the plot view, so
// a cut IS "turn the map into a linescan"). Pure request shaping lives in
// lib/mapcuts; landing (addDataset + setStatus + error handling) is shared
// with the ROI cuts workshop via useCutLanding.ts (RSM_CUTS_PLAN item 8) —
// this hook owns only its own mode/width UI state + the request calls.

import { useState } from "react";

import { rsmCutSegment, rsmLinecut, rsmProjection } from "../../lib/api";
import { lineCutBody, segCutBody, type CutMode, type CutPoint, type CutSpace } from "../../lib/mapcuts";
import type { Dataset } from "../../lib/types";
import { useCutLanding } from "./useCutLanding";

export interface MapCutsState {
  mode: CutMode;
  setMode: (m: CutMode) => void;
  width: number;
  setWidth: (w: number) => void;
  busy: boolean;
  runLine: (mode: "h" | "v", pt: CutPoint) => void;
  runSegment: (a: CutPoint, b: CutPoint) => void;
  runProjection: (axis: "pixels" | "frames") => void;
}

export function useMapCuts(active: Dataset | null, space: CutSpace | null): MapCutsState {
  const { busy, land } = useCutLanding();
  const [mode, setMode] = useState<CutMode>("off");
  const [width, setWidth] = useState(0);

  return {
    mode,
    setMode,
    width,
    setWidth,
    busy,
    runLine: (m, pt) => {
      if (!active || space == null) return;
      void land(rsmLinecut(lineCutBody(active.data, m, pt, space, width)));
    },
    runSegment: (a, b) => {
      if (!active || space == null) return;
      const body = segCutBody(active.data, a, b, space, width);
      if (body) void land(rsmCutSegment(body));
    },
    runProjection: (axis) => {
      if (!active || space == null) return;
      void land(rsmProjection({ dataset: active.data, axis, space }));
    },
  };
}
