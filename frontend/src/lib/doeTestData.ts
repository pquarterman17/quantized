import type { DataStruct } from "./types";

// 2^2 full factorial as calc/doe_sheet.py lays it out: StdOrder, PointType,
// A (coded), B (coded), A, B, Y (empty until filled).
export function designData(y: (number | null)[] = [NaN, NaN, NaN, NaN]): DataStruct {
  const coded = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  return {
    time: [1, 2, 3, 4],
    values: coded.map((c, i) => [i + 1, 0, c[0]!, c[1]!, 10 + 5 * c[0]!, 1 + c[1]!, y[i] ?? NaN]),
    labels: ["StdOrder", "PointType", "A (coded)", "B (coded)", "A", "B", "Y"],
    units: ["", "", "", "", "C", "", ""],
    metadata: {
      x_column_name: "Run",
      doe: {
        version: 1, kind: "full_factorial", model: "interaction",
        factors: [
          { name: "A", letter: "A", low: 5, high: 15, unit: "C", coded_label: "A (coded)", actual_label: "A" },
          { name: "B", letter: "B", low: 0, high: 2, unit: "", coded_label: "B (coded)", actual_label: "B" },
        ],
        response_label: "Y", terms: [["A"], ["B"], ["A", "B"]],
        terms_coded: [["A (coded)"], ["B (coded)"], ["A (coded)", "B (coded)"]],
        runs: 4, randomized: false, seed: null, replicates: 1, center_points: 0, resolution: null,
        generators: [], defining_relation: "I", aliases: [["A"], ["B"], ["AB"]], alpha: null, error_df: 0, notes: [],
      },
    },
    // levels-allowlist: a hand-built fixture of the server's PointType labels, not a level derivation
    cat_levels: { 1: ["factorial", "axial", "center"] },
  };
}
