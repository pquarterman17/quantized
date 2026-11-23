import { describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { DEFAULT_SIGNAL_SETTINGS } from "./signalProcessingModel";
import { signalRangeNote } from "./signalRangeNote";
import { DEFAULT_SPECTRAL_SETTINGS } from "./spectralSettings";

const sheet: Dataset = {
  id: "d", name: "d",
  data: { time: [1, 2, 3, 4], values: [[1], [2], [3], [4]], labels: ["y"], units: [""], metadata: {} },
  excludedRows: [3],
};

describe("signalRangeNote", () => {
  it("is empty without a range, or with an invalid one", () => {
    expect(signalRangeNote(sheet, DEFAULT_SIGNAL_SETTINGS, DEFAULT_SPECTRAL_SETTINGS)).toBe("");
    const bad = { ...DEFAULT_SIGNAL_SETTINGS, useRange: true, xMin: "3", xMax: "2" };
    expect(signalRangeNote(sheet, bad, DEFAULT_SPECTRAL_SETTINGS)).toBe("");
  });

  it("counts the rows inside the inclusive range of the row policy in force", () => {
    const on = { ...DEFAULT_SIGNAL_SETTINGS, useRange: true, xMin: "2", xMax: "4" };
    expect(signalRangeNote(sheet, on, DEFAULT_SPECTRAL_SETTINGS)).toContain("3 of 4 input rows");
    expect(signalRangeNote(sheet, { ...on, useAllRows: false }, DEFAULT_SPECTRAL_SETTINGS)).toContain("2 of 3 input rows");
  });

  it("reads the spectral range for a spectral operation", () => {
    const settings = { ...DEFAULT_SIGNAL_SETTINGS, operation: "fft" as const };
    const spectral = { ...DEFAULT_SPECTRAL_SETTINGS, useRange: true, xMin: "1", xMax: "2" };
    expect(signalRangeNote(sheet, settings, spectral)).toContain("2 of 4 input rows");
  });
});
