// The batch summary's X (lib/batchSummaryX): a parameter of each input instead
// of its position, blank (and reported) where an input has none, sorted only
// on request.

import { describe, expect, it } from "vitest";

import { numericMetaFields, paramNamesOf, summaryX, summaryXNote, type SummaryXInput } from "./batchSummaryX";

const row = (index: number, name: string, ...cells: string[]) => ({ index, role: "label", name, cells });
const inputs: SummaryXInput[] = [
  { name: "run_300K.dat", metadata: { temperature: "300 K", field: 0.5, label_rows: [row(2, "T", "300K", "300K")] } },
  { name: "run_100K.dat", metadata: { temperature: "100 K", field: 0.1, label_rows: [row(2, "T", "100K")] } },
  { name: "run_x.dat", metadata: { note: "no temperature here" } },
  { name: "run_200K.dat", metadata: { temperature: "200 K", field: 0.3, label_rows: [row(2, "T", "200K", "250K")] } },
];

describe("summaryX", () => {
  it("defaults to the input position", () => {
    const r = summaryX(inputs, { source: { kind: "index" }, sort: false });
    expect(r.x).toEqual([1, 2, 3, 4]);
    expect(r.missing).toEqual([]);
  });

  it("reads a metadata field (number and unit), blank and reported where absent - never the index", () => {
    const r = summaryX(inputs, { source: { kind: "meta", path: ["temperature"] }, sort: false });
    expect(r.x.slice(0, 2)).toEqual([300, 100]);
    expect(r.x[2]).toBeNaN();
    expect(r.x[3]).toBe(200);
    expect(r.xName).toBe("temperature");
    expect(r.xUnit).toBe("K");
    expect(r.missing).toEqual(["run_x.dat: no temperature"]);
    expect(summaryXNote(r)).toContain("1 left blank");
  });

  it("leaves a row blank when its unit differs from the others", () => {
    const r = summaryX([
      { name: "a", metadata: { t: "300 K" } }, { name: "b", metadata: { t: "100 K" } }, { name: "c", metadata: { t: "5 mK" } },
    ], { source: { kind: "meta", path: ["t"] }, sort: false });
    expect(r.x[2]).toBeNaN();
    expect(r.missing[0]).toContain("unit mK differs from K");
  });

  it("reads a user-parameter row; channels that disagree are blank, not picked", () => {
    const r = summaryX(inputs, { source: { kind: "param", name: "T" }, sort: false });
    expect(r.x[0]).toBe(300);
    expect(r.x[1]).toBe(100);
    expect(r.x[2]).toBeNaN();
    expect(r.x[3]).toBeNaN();
    expect(r.missing).toEqual(['run_x.dat: no value for parameter "T"', 'run_200K.dat: parameter "T" differs between columns']);
  });

  it("reads the first number in the name, blank when there is none", () => {
    const r = summaryX([{ name: "S1 300 K" }, { name: "sample" }, { name: "1e-3 T.dat" }], { source: { kind: "name" }, sort: false });
    expect(r.x[0]).toBe(1);
    expect(r.x[1]).toBeNaN();
    expect(r.x[2]).toBe(0.001);
    expect(r.missing).toEqual(["sample: no number in its name"]);
  });

  it("sorts by X only when asked: stable, blank rows last, order maps output to input", () => {
    const unsorted = summaryX(inputs, { source: { kind: "meta", path: ["temperature"] }, sort: false });
    expect(unsorted.order).toEqual([0, 1, 2, 3]);
    const sorted = summaryX(inputs, { source: { kind: "meta", path: ["temperature"] }, sort: true });
    expect(sorted.order).toEqual([1, 3, 0, 2]);
    expect(sorted.x.slice(0, 3)).toEqual([100, 200, 300]);
    expect(sorted.x[3]).toBeNaN();
  });

  it("an unnamed field or parameter blanks every row", () => {
    expect(summaryX(inputs, { source: { kind: "meta", path: [] }, sort: false }).missing).toHaveLength(4);
    expect(summaryX(inputs, { source: { kind: "param", name: " " }, sort: false }).missing).toHaveLength(4);
  });

  it("lists the numeric metadata fields and parameter names to pick from", () => {
    const sets = inputs.map((d, i) => ({ id: String(i), data: { metadata: d.metadata ?? {}, labels: ["A", "B"] } }));
    expect(numericMetaFields(sets).map((f) => f.label)).toEqual(expect.arrayContaining(["temperature", "field"]));
    expect(numericMetaFields(sets).map((f) => f.label)).not.toContain("note");
    expect(paramNamesOf(sets)).toEqual(["T"]);
  });
});
