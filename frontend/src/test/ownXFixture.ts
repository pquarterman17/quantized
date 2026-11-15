// A T1,R1,T2,R2 sheet whose two X columns hold DIFFERENT, non-monotonic values,
// so analysing R2 against T1 instead of T2 changes every number. `time` is T1;
// the value channels are R1 (0), T2 (1, "Set As X"), R2 (2).
import type { Dataset } from "../lib/types";

export const T1 = [1, 2, 3, 4];
export const R1 = [10, 20, 30, 40];
export const T2 = [40, 10, 30, 20];
export const R2 = [100, 200, 300, 400];

export function t1r1t2r2(): Dataset {
  return {
    id: "own",
    name: "own.csv",
    data: {
      time: T1,
      values: T1.map((_, i) => [R1[i], T2[i], R2[i]]),
      labels: ["R1", "T2", "R2"],
      units: ["ohm", "Oe", "ohm"],
      metadata: { x_column_name: "T1", x_column_unit: "K" },
    },
    columnDesignations: { 1: "X" },
  };
}
