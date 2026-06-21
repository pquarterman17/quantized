// Synthetic DataStruct for offline demos / tests (a VSM-like M(H) loop).
// Mirrors the backend DataStruct shape so the same UI path exercises it.

import type { DataStruct } from "./types";

export function makeDemoDataset(): DataStruct {
  const n = 201;
  const time: number[] = [];
  const values: number[][] = [];
  const ms = 3.0;
  const hc = 800;
  const w = 400;
  for (let i = 0; i < n; i++) {
    const frac = i / (n - 1);
    const h = -5000 + frac * 10000; // field sweep, Oe
    const m = ms * Math.tanh((h - hc) / w) + 0.0002 * h; // loop + diamag slope
    time.push(h);
    values.push([m]);
  }
  return {
    time,
    values,
    labels: ["Moment"],
    units: ["emu"],
    metadata: { x_column_name: "Field", x_column_unit: "Oe", source: "demo" },
  };
}
