// The ternary defaults read the first three NUMERIC columns in sheet order, X included.

import { describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { compositionPicks } from "./auxColumns";

const sheet = (labels: string[], time = [0.5, 0.2], extra: Partial<DataStruct> = {}): DataStruct => ({
  time, values: time.map(() => labels.map(() => 1)), labels, units: labels.map(() => ""), metadata: {}, ...extra,
});

describe("compositionPicks", () => {
  it("an A,B,C sheet (X = A, channels B, C) picks A, B, C", () => {
    expect(compositionPicks(sheet(["B", "C"]), 3)).toEqual([-1, 0, 1]);
  });
  it("A in X with many channels still picks A, B, C, not the first three channels", () => {
    expect(compositionPicks(sheet(["B", "C", "g", "Ae", "Be", "Ce"]), 3)).toEqual([-1, 0, 1]);
    expect(compositionPicks(sheet(["B", "C", "g", "Ae", "Be", "Ce"]), 6)).toEqual([-1, 0, 1, 2, 3, 4]);
  });
  it("text (categorical) channels are skipped in sheet order", () => {
    const s = sheet(["name", "B", "C"], [0.5, 0.2], { cat_levels: { 0: ["a", "b"] } });
    expect(compositionPicks(s, 3)).toEqual([-1, 1, 2]);
  });
  it("a row-counter X (1..N, 0..N-1, or the synthetic Sample Index) is not a composition", () => {
    expect(compositionPicks(sheet(["A", "B", "C"], [1, 2, 3]), 3)).toEqual([0, 1, 2]);
    expect(compositionPicks(sheet(["A", "B", "C"], [0, 1, 2]), 3)).toEqual([0, 1, 2]);
    expect(compositionPicks(sheet(["A", "B", "C"], [4, 9], { metadata: { x_column_name: "Sample Index" } }), 3)).toEqual([0, 1, 2]);
  });
  it("a row-counter X still leads when the channels alone cannot fill the picks", () => {
    expect(compositionPicks(sheet(["B", "C"], [1, 2, 3]), 3)).toEqual([-1, 0, 1]);
  });
  it("short of numeric columns, the rest fall back to remaining channels, then X", () => {
    const s = sheet(["name", "B"], [0.5, 0.2], { cat_levels: { 0: ["a", "b"] } });
    expect(compositionPicks(s, 4)).toEqual([-1, 1, 0, -1]);
  });
});
