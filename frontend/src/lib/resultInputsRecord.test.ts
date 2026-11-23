import { describe, expect, it } from "vitest";

import { sanitizeAnalysisResults } from "./analysisResult";
import { committedOutputResult } from "./committedOutput";
import { MAX_RECORDED_CHANNELS, MAX_RECORDED_INPUTS, INPUTS_PARAM, recordedInput, recordedInputs, type InputX } from "./resultInputsRecord";
import type { Dataset } from "./types";

const wide = (id: string, channels: number): Dataset => ({
  id, name: id,
  data: {
    time: [0, 1, 2], values: [0, 1, 2].map(() => Array.from({ length: channels }, (_, i) => i)),
    labels: Array.from({ length: channels }, (_, i) => `c${i}`), units: Array.from({ length: channels }, () => "u"), metadata: {},
  },
});

describe("recorded inputs stay inside the reopen sanitizer's budget", () => {
  it("a 600-source batch of 40-channel worksheets keeps its commit key and inputs after a save/reopen", () => {
    const sources = Array.from({ length: 600 }, (_, i) => wide(`s${i}`, 40));
    const result = committedOutputResult({
      id: "r", producer: { id: "p", label: "P", version: 1 }, source: sources[0]!, extraSources: sources.slice(1),
      output: wide("out", 1), key: "k", settings: { a: 1 },
    });
    const inputs = result.parameters![INPUTS_PARAM] as { total: number; items: unknown[] };
    expect(inputs.total).toBe(600);
    expect(inputs.items).toHaveLength(MAX_RECORDED_INPUTS);
    const [reopened] = sanitizeAnalysisResults(JSON.parse(JSON.stringify([result])));
    expect(reopened?.parameters?.["commitKey"]).toBe("k");
    expect(reopened?.parameters?.[INPUTS_PARAM]).toBeDefined();
  });

  it("caps channels per input but records the true count", () => {
    const result = committedOutputResult({
      id: "r", producer: { id: "p", label: "P", version: 1 }, source: wide("s", 500), output: wide("o", 1), key: "k", settings: {},
    });
    const [item] = (result.parameters![INPUTS_PARAM] as { items: { channels: unknown[]; channelCount: number }[] }).items;
    expect(item!.channels).toHaveLength(MAX_RECORDED_CHANNELS);
    expect(item!.channelCount).toBe(500);
  });
});

describe("recordedInput takes the X range from the column the tool used (acceptance C9)", () => {
  const sheet: Dataset = {
    id: "s", name: "s",
    data: { time: [0, 1, 2], values: [[5, 100], [7, 200], [6, 300]], labels: ["T", "Y"], units: ["K", "emu"], metadata: { x_column_name: "Index", x_column_unit: "pt" } },
  };
  const rangeOf = (xKey: InputX) => (recordedInput(sheet, { xKey }) as { xRange: unknown; xLabel: unknown; xUnit: unknown });

  it("a channel X records that channel's range and name", () => {
    expect(rangeOf(0)).toMatchObject({ xRange: [5, 7], xLabel: "T", xUnit: "K" });
    expect(rangeOf(1)).toMatchObject({ xRange: [100, 300], xLabel: "Y", xUnit: "emu" });
  });

  it("null is the time axis with its own name", () => {
    expect(rangeOf(null)).toMatchObject({ xRange: [0, 2], xLabel: "Index", xUnit: "pt" });
  });

  it("fails closed: an unknown, fractional, negative or out-of-range X records no range", () => {
    for (const xKey of [undefined, 2, -1, 0.5, Number.NaN]) {
      expect(rangeOf(xKey)).toMatchObject({ xRange: null, xLabel: null, xUnit: null });
    }
  });

  it("recordedInputs takes one X per source when given a list", () => {
    const other: Dataset = { ...sheet, id: "o" };
    const { items } = recordedInputs([sheet, other], { xKey: [0, undefined] }) as { items: { xRange: unknown }[] };
    expect(items.map((i) => i.xRange)).toEqual([[5, 7], null]);
  });
});

describe("recordedInput with an X window (an optional X range)", () => {
  const source = {
    id: "d", name: "scan",
    data: { time: [0, 1, 2, 3, 4], values: [[1], [2], [3], [4], [5]], labels: ["y"], units: [""], metadata: {} },
  } as unknown as Dataset;

  it("records only the rows inside the window, inclusive at both ends", () => {
    expect(recordedInput(source, { xKey: null, xWindow: [1, 3] })).toMatchObject({ rows: 5, includedRows: 3, xRange: [1, 3] });
  });

  it("a spectrogram's yChannel counts finite (X, Y) pairs, like the backend", () => {
    const gappy = { ...source, data: { ...source.data, values: [[1], [Number.NaN], [3], [4], [5]] } } as unknown as Dataset;
    expect(recordedInput(gappy, { xKey: null, yChannel: 0 })).toMatchObject({ includedRows: 4, xRange: [0, 4] });
    expect(recordedInput(gappy, { xKey: null, xWindow: [1, 3], yChannel: 0 })).toMatchObject({ includedRows: 2, xRange: [2, 3] });
    expect(recordedInput(gappy, { xKey: null })).toMatchObject({ includedRows: 5 }); // no yChannel: unchanged
  });

  it("an open end keeps the data's own end; no window is the whole view", () => {
    expect(recordedInput(source, { xKey: null, xWindow: [2, null] })).toMatchObject({ includedRows: 3, xRange: [2, 4] });
    expect(recordedInput(source, { xKey: null })).toMatchObject({ includedRows: 5, xRange: [0, 4] });
  });

  it("a window with no rows records no range", () => {
    expect(recordedInput(source, { xKey: null, xWindow: [10, 20] })).toMatchObject({ includedRows: 0, xRange: null });
  });
});
