// Perf audit 2026-09-29: autosave re-serialized the whole workspace on the main
// thread (4.3 s at 1M×8) — pretty-printed, and with the BUG-017 replacer called
// on every single cell. The document is now compact, each dataset's cells are
// cached per `data` object identity, and clean arrays skip the replacer. This
// file pins what must NOT change: the sentinel encoding is byte-identical to
// the replacer's, it round-trips exactly, and an edit invalidates the cache.

import { describe, expect, it } from "vitest";

import { dataStructJson } from "./dataStructJson";
import { encodePersistedCells } from "./nonFiniteCells";
import type { Dataset, DataStruct } from "./types";
import { parseWorkspace, serializeWorkspace } from "./workspace";

const SPECIAL = [Number.NaN, Infinity, -Infinity, -0];

function ds(id: string, data: DataStruct, extra: Partial<Dataset> = {}): Dataset {
  return { id, name: id, data, ...extra };
}

function struct(time: number[], values: number[][], metadata: Record<string, unknown> = { src: "t" }): DataStruct {
  const labels = (values[0] ?? []).map((_, i) => `c${i}`);
  return { time, values, labels, units: labels.map(() => ""), metadata };
}

describe("dataStructJson — byte parity with the BUG-017 replacer", () => {
  const cases: [string, DataStruct][] = [
    ["all finite", struct([0, 1, 2], [[1, 2], [3, 4], [5, 6]])],
    ["specials in time", struct([...SPECIAL], [[1], [2], [3], [4]])],
    ["specials in one row", struct([0, 1, 2, 3], [[1], [Number.NaN], [-0], [Infinity]])],
    ["null cells pass through", struct([0, 1], [[null as unknown as number, -0], [1, 2]])],
    // A nested `{ metadata, time }` object inside metadata is encoded by the
    // replacer too; the fast path must not change what happens to it.
    ["nested metadata/time shape", struct([0], [[1]], { inner: { metadata: {}, time: [Number.NaN, -0] } })],
    ["no metadata (replacer leaves cells alone)", { ...struct([Number.NaN], [[-0]]), metadata: undefined as never }],
  ];
  it.each(cases)("%s", (_name, data) => {
    expect(dataStructJson(data)).toBe(JSON.stringify(data, encodePersistedCells));
  });
});

describe("serializeWorkspace — compact output, exact round trip", () => {
  it("writes compact JSON (no indentation) for the autosave", () => {
    const text = serializeWorkspace({ datasets: [ds("a", struct([0, 1], [[1], [2]]))] }, { compact: true });
    expect(text).not.toContain("\n");
    expect(text.startsWith('{"format":')).toBe(true);
  });

  it("a user Save keeps the document indented, with each dataset's cells compact", () => {
    const text = serializeWorkspace({ datasets: [ds("a", struct([0, 1], [[1], [2]]))] });
    expect(text).toContain('\n  "format": ');
    expect(text).toContain('"time":[0,1],"values":[[1],[2]]');
    // Compare everything but the save timestamp: two calls can straddle a
    // millisecond (CI saw 22:44:00.888 vs .889), so savedAt is not content.
    const content = (t: string) => ({ ...(JSON.parse(t) as Record<string, unknown>), savedAt: null });
    const compact = serializeWorkspace({ datasets: [ds("a", struct([0, 1], [[1], [2]]))] }, { compact: true });
    expect(content(text)).toEqual(content(compact));
  });

  it("round-trips NaN, ±Infinity and -0 in data AND raw exactly", () => {
    const data = struct([...SPECIAL, 5], [...SPECIAL.map((v) => [v, 1]), [2, -0]]);
    const raw = struct([...SPECIAL], SPECIAL.map((v) => [v]));
    const back = parseWorkspace(serializeWorkspace({ datasets: [ds("a", data, { raw })] })).datasets[0];
    const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
    expect(same(back.data.time, data.time)).toBe(true);
    data.values.forEach((row, i) => expect(same(back.data.values[i], row)).toBe(true));
    expect(same(back.raw!.time, raw.time)).toBe(true);
    raw.values.forEach((row, i) => expect(same(back.raw!.values[i], row)).toBe(true));
  });

  it("the document parses identically whether pretty-printed (legacy) or compact", () => {
    const text = serializeWorkspace({ datasets: [ds("a", struct([0, -0], [[Number.NaN], [1]]))] });
    const pretty = JSON.stringify(JSON.parse(text), null, 2);
    expect(parseWorkspace(pretty).datasets).toEqual(parseWorkspace(text).datasets);
    expect(Object.is(parseWorkspace(pretty).datasets[0].data.time[1], -0)).toBe(true);
  });

  it("is the same document the replacer alone would write", () => {
    const datasets = [
      ds("a", struct([0, Number.NaN], [[1, -0], [Infinity, 2]]), { raw: struct([1], [[-Infinity]]) }),
      ds("b", struct([0], [[7]])),
    ];
    const ours = JSON.parse(serializeWorkspace({ datasets })) as Record<string, unknown>;
    const ref = JSON.parse(JSON.stringify(ours, encodePersistedCells)) as Record<string, unknown>;
    const sentinelRows = (ours.datasets as { data: { values: unknown[][] } }[])[0].data.values;
    expect(sentinelRows).toEqual([[1, "-0"], ["Infinity", 2]]);
    expect(ours).toEqual(ref);
  });
});

describe("serializeWorkspace — per-`data` cell cache", () => {
  it("reuses a dataset's cells while its `data` object is unchanged, and re-encodes after an edit", () => {
    const data = struct([0, 1], [[1], [2]]);
    const first = serializeWorkspace({ datasets: [ds("a", data)] });
    expect(parseWorkspace(first).datasets[0].data.values[1][0]).toBe(2);

    // Proof the cache is keyed on identity: an (illegal) in-place write to the
    // SAME object is not seen, because nothing re-encodes it.
    (data.values[1] as number[])[0] = 99;
    const cached = serializeWorkspace({ datasets: [ds("a", data)] });
    expect(parseWorkspace(cached).datasets[0].data.values[1][0]).toBe(2);

    // A real edit mints a new `data` object (store/cellEdit.ts), which misses
    // the cache — including one that introduces a sentinel.
    const edited: DataStruct = { ...data, values: [[1], [-0]] };
    const after = parseWorkspace(serializeWorkspace({ datasets: [ds("a", edited)] })).datasets[0];
    expect(Object.is(after.data.values[1][0], -0)).toBe(true);
  });

  it("a rename (same `data`, new dataset object) still writes the new name", () => {
    const data = struct([0], [[1]]);
    serializeWorkspace({ datasets: [ds("a", data)] });
    const back = parseWorkspace(serializeWorkspace({ datasets: [{ ...ds("a", data), name: "renamed" }] }));
    expect(back.datasets[0].name).toBe("renamed");
  });
});
