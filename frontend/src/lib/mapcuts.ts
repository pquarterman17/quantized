// Pure helpers for the 2-D map cut tool (ORIGIN_GAP_PLAN #18/#46): map a
// click/drag gesture in data coordinates onto a backend cut request. Kept
// pure so the gesture→request mapping is unit-testable without a canvas.

import type { DataStruct } from "./types";

export type CutMode = "off" | "h" | "v" | "seg";
export type CutSpace = "angular" | "q";

export interface CutPoint {
  x: number;
  y: number;
}

/** Cuts are only defined when the displayed axes are one of the RSM pairs
 *  (2θ/ω or Qx/Qz) — arbitrary channel picks have no cut semantics. */
export function cutSpaceForKeys(isAngular: boolean, isQ: boolean): CutSpace | null {
  if (isAngular) return "angular";
  if (isQ) return "q";
  return null;
}

export function lineCutBody(
  dataset: DataStruct,
  mode: "h" | "v",
  pt: CutPoint,
  space: CutSpace,
  width: number,
): { dataset: DataStruct; direction: "h" | "v"; value: number; space: string; width: number } {
  // An H-cut fixes the VERTICAL axis value (cut runs horizontally), and vice versa.
  return {
    dataset,
    direction: mode,
    value: mode === "h" ? pt.y : pt.x,
    space,
    width,
  };
}

export function segCutBody(
  dataset: DataStruct,
  a: CutPoint,
  b: CutPoint,
  space: CutSpace,
  width: number,
  n = 300,
): {
  dataset: DataStruct;
  p0: [number, number];
  p1: [number, number];
  n: number;
  width: number;
  space: string;
} | null {
  // A zero-length drag is a click, not a cut.
  if (a.x === b.x && a.y === b.y) return null;
  return { dataset, p0: [a.x, a.y], p1: [b.x, b.y], n, width, space };
}

/** Display name for the resulting library dataset. */
export function cutName(data: DataStruct, fallback = "line cut"): string {
  const label = data.metadata?.["cut_label"];
  return typeof label === "string" && label ? label : fallback;
}
