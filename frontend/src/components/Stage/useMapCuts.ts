// State + actions for the map cut tool (ORIGIN_GAP_PLAN #18/#46): arm an
// H/V/segment cut mode, fire the backend cut, land the result in the library
// as a normal 1-D dataset (addDataset switches the stage to the plot view, so
// a cut IS "turn the map into a linescan"). Pure request shaping lives in
// lib/mapcuts; this hook owns the async + store wiring.

import { useState } from "react";

import { rsmCutSegment, rsmLinecut, rsmProjection } from "../../lib/api";
import {
  cutName,
  lineCutBody,
  segCutBody,
  type CutMode,
  type CutPoint,
  type CutSpace,
} from "../../lib/mapcuts";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

let _seq = 0;

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
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);
  const [mode, setMode] = useState<CutMode>("off");
  const [width, setWidth] = useState(0);
  const [busy, setBusy] = useState(false);

  async function land(promise: Promise<import("../../lib/types").DataStruct>): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const data = await promise;
      const name = cutName(data);
      addDataset({ id: `cut-${++_seq}`, name, data });
      setStatus(`cut added: ${name}`);
    } catch (e) {
      setStatus(e instanceof Error ? `cut failed: ${e.message}` : "cut failed");
    } finally {
      setBusy(false);
    }
  }

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
