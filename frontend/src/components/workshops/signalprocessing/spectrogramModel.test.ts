import { describe, expect, it } from "vitest";

import {
  DEFAULT_SPECTROGRAM_FORM,
  SPECTROGRAM_MAX_CELLS,
  spectrogramGrid,
  spectrogramParams,
  type SpectrogramForm,
} from "./spectrogramModel";

const form = (patch: Partial<SpectrogramForm>): SpectrogramForm => ({ ...DEFAULT_SPECTROGRAM_FORM, ...patch });

describe("spectrogramParams", () => {
  it("turns the form into the request fields (percent -> fraction)", () => {
    expect(spectrogramParams(form({ segmentLen: "128", overlapPct: "75", window: "hamming", scaling: "amplitude", detrend: "linear", resample: true }), 2, 1000))
      .toEqual({ channel: 2, segment_len: 128, window: "hamming", overlap: 0.75, scaling: "amplitude", detrend: "linear", resample: true });
  });

  it("defaults are off: no resampling, Hann, 50 % overlap", () => {
    expect(spectrogramParams(DEFAULT_SPECTROGRAM_FORM, 0, 1000)).toMatchObject({ window: "hann", overlap: 0.5, resample: false });
  });

  it.each([
    [form({ segmentLen: "4" }), 0, 1000, /at least 8/],
    [form({ segmentLen: "12.5" }), 0, 1000, /whole number/],
    [form({ segmentLen: "" }), 0, 1000, /whole number/],
    [form({ segmentLen: "2000" }), 0, 1000, /cannot exceed/],
    [form({ overlapPct: "100" }), 0, 1000, /under 100/],
    [form({ overlapPct: "-1" }), 0, 1000, /at least 0/],
    [form({}), null, 1000, /Select a signal column/],
    [form({ segmentLen: "4096", overlapPct: "99" }), 0, 5_000_000, /limit/],
  ])("refuses with a sentence: %#", (f, channel, rows, message) => {
    const out = spectrogramParams(f, channel, rows);
    expect(typeof out).toBe("string");
    expect(out).toMatch(message);
  });

  it("counts finite (X, Y) pairs for the segment-length check, as the backend does", () => {
    const x = Array.from({ length: 100 }, (_, i) => i);
    const y = x.map((i) => (i < 50 ? Number.NaN : i)); // only 50 rows are usable
    expect(spectrogramParams(form({ segmentLen: "64" }), 0, 100, x, y)).toMatch(/cannot exceed the 50 rows/);
    expect(spectrogramParams(form({ segmentLen: "32" }), 0, 100, x, y)).toMatchObject({ segment_len: 32 });
    const ranged = form({ segmentLen: "64", useRange: true, xMin: "40", xMax: "99" });
    expect(spectrogramParams(ranged, 0, 100, x, y)).toMatch(/cannot exceed the 50 rows/);
  });

  it("keeps the cell limit in step with the backend", () => {
    expect(SPECTROGRAM_MAX_CELLS).toBe(2_000_000);
  });
});

describe("the committed table is a map", () => {
  it("the Map tab's grid gate accepts the long-form (segment, frequency, value) layout", async () => {
    const { hasGridAxes } = await import("../../../lib/mapGate");
    const time: number[] = [];
    const values: number[][] = [];
    for (let s = 0; s < 6; s++) for (let f = 0; f < 9; f++) { time.push(0.1 + s * 0.05); values.push([f * 6.25, s * f]); }
    expect(hasGridAxes({ time, values, labels: ["Frequency", "V · Spectrogram"], units: ["1/s", ""], metadata: {} })).toBe(true);
  });
});

describe("spectrogramGrid", () => {
  const table = (rows: number, segments: unknown, frequencies: unknown, operation = "spectrogram") => ({
    time: Array.from({ length: rows }, () => 0), values: [], labels: [], units: [],
    metadata: { spectralAnalysis: { operation, parameters: { segments, frequencies } } },
  });
  it("reads the recorded grid only when it matches the row count", () => {
    expect(spectrogramGrid(table(27, 3, 9))).toEqual({ segments: 3, frequencies: 9 });
    expect(spectrogramGrid(table(26, 3, 9))).toBeNull();
    expect(spectrogramGrid(table(27, 3, 9, "fft"))).toBeNull();
    expect(spectrogramGrid(table(27, "3", 9))).toBeNull();
  });
});
