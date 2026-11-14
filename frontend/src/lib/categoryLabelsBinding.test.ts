// Worksheet audit #1: Tabulate grouped by the numeric "Signal" column titled
// every group with a Date string. The category-label resolver accepted ANY
// text column whose cells agree with the channel's levels, and a continuous
// column has a distinct value on every row, so a unique-per-row text column
// (dates, IDs) agreed trivially. A text column found by agreement alone now
// has to really label groups (levels repeat, one text per level); the
// column's own text (same name / Origin short name) is still always used.

import { describe, expect, it } from "vitest";

import { resolveCategoryLabels } from "./barlayout";
import type { DataStruct } from "./types";

const signal = [0.1, 0.32, 0.61, 0.84, 0.97, 0.99, 0.9, 0.72];
const dates = signal.map((_, i) => `2026-03-0${i + 1} 12:00:00`);
const samples = signal.map((_, i) => `S${i % 3}`);
const codes = signal.map((_, i) => i % 3);

function ds(metadata: Record<string, unknown>, labels = ["Signal", "Code"]): DataStruct {
  return {
    time: signal.map((_, i) => 10 + 5 * i),
    values: signal.map((s, i) => [s, codes[i]]),
    labels,
    units: ["mV", ""],
    metadata,
  } as DataStruct;
}

describe("category labels from a text column", () => {
  it("never titles a continuous column's groups with an unrelated unique text column", () => {
    const data = ds({ text_columns: { Date: dates } });
    const labels = resolveCategoryLabels(data, 0, [...signal].sort((a, b) => a - b));
    expect(labels.some((l) => l.startsWith("2026"))).toBe(false);
    expect(labels[0]).toBe("0.1");
  });

  it("still names a repeating code column from a text column that labels its groups", () => {
    const data = ds({ text_columns: { Date: dates, Sample: samples } });
    expect(resolveCategoryLabels(data, 1, [0, 1, 2])).toEqual(["S0", "S1", "S2"]);
  });

  it("names a small grouping where only one level repeats", () => {
    const data = {
      time: [1, 2, 3, 4],
      values: [[1], [1], [2], [3]],
      labels: ["Code"],
      units: [""],
      metadata: { text_columns: { Batch: ["a", "a", "b", "c"] } },
    } as DataStruct;
    expect(resolveCategoryLabels(data, 0, [1, 2, 3])).toEqual(["a", "b", "c"]);
  });

  it("uses the channel's OWN text column even when every level occurs once", () => {
    // An Origin label column: numeric codes + `origin_text_columns` under the
    // same short name, one row per category (a bar chart's X).
    const data = ds({
      origin_column_names: ["B", "C"],
      origin_text_columns: { B: dates },
    });
    expect(resolveCategoryLabels(data, 0, signal)).toEqual(dates);
  });
});
