// The ternary request builder: three composition columns (+ optional colour
// column) from a DataStruct -> the exact `/api/export/ternary-figure` body,
// with rows the renderer cannot draw counted out.

import { describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { buildTernaryRequest, droppedRowsNotice } from "./ternaryRequest";

const data: DataStruct = {
  time: [1, 2, 3, 4, 5, 6],
  values: [
    [0.2, 0.3, 0.5, 10],
    [0.5, 0.25, 0.25, 11],
    [NaN, 0.5, 0.5, 12],
    [0.4, -0.1, 0.7, 13],
    [0, 0, 0, 14],
    [0.1, 0.1, 0.8, NaN],
  ],
  labels: ["Fe", "Co", "Ni", "Tc"],
  units: ["at%", "at%", "at%", "K"],
  metadata: { x_column_name: "sample" },
};

describe("buildTernaryRequest", () => {
  it("posts the kept rows as (n, 3) compositions labelled by the picked columns", () => {
    const built = buildTernaryRequest(data, { a: 0, b: 1, c: 2, colorBy: null }, { title: "alloys", filename: "alloys-ternary" });
    expect(built.spec).toEqual({
      data: [
        [0.2, 0.3, 0.5],
        [0.5, 0.25, 0.25],
        [0.1, 0.1, 0.8],
      ],
      labels: ["Fe", "Co", "Ni"],
      values: null,
      title: "alloys",
      filename: "alloys-ternary",
    });
    expect(built.total).toBe(6);
    expect(built.dropped).toBe(3);
  });

  it("drops a row whose colour value is not finite and sends the rest as `values`", () => {
    const built = buildTernaryRequest(data, { a: 0, b: 1, c: 2, colorBy: 3 }, { title: "", filename: "t" });
    expect(built.spec?.data).toEqual([
      [0.2, 0.3, 0.5],
      [0.5, 0.25, 0.25],
    ]);
    expect(built.spec?.values).toEqual([10, 11]);
    expect(built.dropped).toBe(4);
  });

  it("accepts the X column (index -1) as a component", () => {
    const built = buildTernaryRequest(data, { a: -1, b: 1, c: 2, colorBy: null }, { title: "", filename: "t" });
    expect(built.spec?.labels).toEqual(["sample", "Co", "Ni"]);
    expect(built.spec?.data[0]).toEqual([1, 0.3, 0.5]);
  });

  it("builds no request when every row is undrawable", () => {
    const empty: DataStruct = { ...data, values: [[NaN, 1, 1]], time: [1], labels: ["a", "b", "c"], units: ["", "", ""] };
    const built = buildTernaryRequest(empty, { a: 0, b: 1, c: 2, colorBy: null }, { title: "", filename: "t" });
    expect(built.spec).toBeNull();
    expect(built.dropped).toBe(1);
  });
});

describe("droppedRowsNotice", () => {
  it("is one sentence with the count, or nothing when every row drew", () => {
    expect(droppedRowsNotice(3, 6)).toBe("3 of 6 rows have a non-finite, negative or all-zero value and were left out.");
    expect(droppedRowsNotice(1, 6)).toBe("1 of 6 rows has a non-finite, negative or all-zero value and was left out.");
    expect(droppedRowsNotice(0, 6)).toBeNull();
  });
});
