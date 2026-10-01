// The vector-field request builder: scattered X/Y/U/V rows -> the regular
// grid `/api/export/field-figure` takes, or a one-sentence reason it cannot.

import { describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { buildFieldRequest } from "./fieldRequest";

function ds(rows: number[][]): DataStruct {
  return {
    time: rows.map((_, i) => i),
    values: rows,
    labels: ["x", "y", "u", "v"],
    units: ["mm", "mm", "", ""],
    metadata: {},
  };
}

const PICKS = { x: 0, y: 1, u: 2, v: 3 };
const OPTS = { kind: "quiver" as const, title: "flow", filename: "flow-field", xLabel: "x (mm)", yLabel: "y (mm)" };

describe("buildFieldRequest", () => {
  it("grids scattered rows in any order into (ny, nx) component arrays", () => {
    const built = buildFieldRequest(
      ds([
        [1, 20, 0.5, 0.1],
        [0, 10, 0.1, 0.2],
        [1, 10, 0.3, 0.4],
        [0, 20, 0.7, 0.8],
      ]),
      PICKS,
      OPTS,
    );
    expect(built.error).toBeNull();
    expect(built.spec).toEqual({
      x_axis: [0, 1],
      y_axis: [10, 20],
      u_grid: [
        [0.1, 0.3],
        [0.7, 0.5],
      ],
      v_grid: [
        [0.2, 0.4],
        [0.8, 0.1],
      ],
      kind: "quiver",
      title: "flow",
      x_label: "x (mm)",
      y_label: "y (mm)",
      filename: "flow-field",
    });
    expect(built.dropped).toBe(0);
    expect(built.total).toBe(4);
  });

  it("counts out rows with a non-finite value before gridding", () => {
    const built = buildFieldRequest(
      ds([
        [0, 0, 1, 1],
        [1, 0, NaN, 1],
        [0, 1, 1, 1],
        [1, 1, 1, 1],
      ]),
      PICKS,
      { ...OPTS, kind: "streamline" },
    );
    expect(built.dropped).toBe(1);
    expect(built.spec).toBeNull();
    expect(built.error).toBe("Rows cover 3 of the 4 X×Y grid points, so no field can be drawn.");
  });

  it("refuses a grid point that two rows both fill", () => {
    const built = buildFieldRequest(
      ds([
        [0, 0, 1, 1],
        [0, 0, 2, 2],
        [1, 0, 1, 1],
        [0, 1, 1, 1],
        [1, 1, 1, 1],
      ]),
      PICKS,
      OPTS,
    );
    expect(built.spec).toBeNull();
    expect(built.error).toBe("1 X×Y grid point is filled by more than one row, so no field can be drawn.");
  });

  it("needs at least a 2×2 grid", () => {
    const built = buildFieldRequest(ds([[0, 0, 1, 1], [1, 0, 1, 1]]), PICKS, OPTS);
    expect(built.spec).toBeNull();
    expect(built.error).toBe("A vector field needs at least two distinct X and two distinct Y values.");
  });

  it("carries the streamline kind", () => {
    const built = buildFieldRequest(
      ds([
        [0, 0, 1, 1],
        [1, 0, 1, 1],
        [0, 1, 1, 1],
        [1, 1, 1, 1],
      ]),
      PICKS,
      { ...OPTS, kind: "streamline" },
    );
    expect(built.spec?.kind).toBe("streamline");
  });
});
