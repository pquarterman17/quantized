import { describe, expect, it } from "vitest";

import { decodeCell, encodeCell } from "../../../lib/nonFiniteCells";
import { makeDataset as ds, makeRecord } from "./reflFit.testkit";
import {
  HISTORY_LIMIT,
  channelDigest,
  decodeNum,
  decodeRecord,
  encodeNum,
  encodeRecord,
  nextSeq,
  recordId,
  recordsFor,
  withFitRecord,
} from "./reflFitRecord";

describe("reflFitRecord — the stored form", () => {
  it("restates lib/nonFiniteCells' codec exactly (the real pair is the oracle)", () => {
    for (const v of [0, -0, 1.5, -2e-300, Number.NaN, Infinity, -Infinity, Number.MAX_VALUE]) {
      expect(Object.is(encodeNum(v), encodeCell(v))).toBe(true);
    }
    for (const w of [0, 3, "NaN", "Infinity", "-Infinity", "-0", "nan", "", null, undefined, "1", {}, true]) {
      expect(Object.is(decodeNum(w), decodeCell(w))).toBe(true);
    }
  });

  it("round-trips through JSON with NaN, ±Infinity and -0 intact and null stderr still null", () => {
    const rec = makeRecord();
    rec.request.parameters[0].value = Number.NaN;
    rec.result.chi2 = Infinity;
    const stored = encodeRecord(rec);
    // The stored form is plain JSON: stringify loses nothing.
    const back = decodeRecord(JSON.parse(JSON.stringify(stored)));
    expect(back).not.toBeNull();
    expect(back!.request.parameters[0].value).toBeNaN();
    expect(back!.request.parameters[1].min).toBe(-Infinity);
    expect(back!.request.parameters[1].max).toBe(Infinity);
    expect(back!.result.chi2).toBe(Infinity);
    expect(Object.is(back!.model.layers[2].msld, -0)).toBe(true);
    expect(back!.result.parameters[1].stderr).toBeNull();
    expect(back!.result.correlation).toEqual([
      [1, null],
      [null, 1],
    ]);
    expect(back).toEqual(rec);
  });

  it("encodes the non-finite numbers as the BUG-017 sentinel strings, never as null", () => {
    const rec = makeRecord();
    rec.result.chi2 = Number.NaN;
    const text = JSON.stringify(encodeRecord(rec));
    expect(text).toContain('"chi2":"NaN"');
    expect(text).toContain('"min":"-Infinity"');
    expect(text).toContain('"stderr":null');
  });

  it("skips a malformed or future-version record instead of throwing", () => {
    const good = encodeRecord(makeRecord());
    const bad = [
      null,
      "x",
      { ...(good as object), version: 2 },
      { ...(good as object), id: 7 },
      { ...(good as object), request: { ...(good as { request: object }).request, channels: [] } },
      { ...(good as object), result: { weighting: "chi" } },
    ];
    for (const b of bad) expect(decodeRecord(b)).toBeNull();
    const d = ds("xrr", [...bad, good]);
    expect(recordsFor(d).map((r) => r.id)).toEqual(["rfit-abc-1"]);
    // A non-array field (a hand-edited file) reads as no history.
    expect(recordsFor({ ...ds("xrr"), reflFits: "oops" as unknown as unknown[] })).toEqual([]);
  });

  it("re-derives the objective label rather than trusting the file", () => {
    const stored = encodeRecord(makeRecord()) as { result: { objective: { label: string } } };
    stored.result.objective.label = "chi-square (trust me)";
    expect(decodeRecord(stored)!.result.objective).toEqual({ label: "reduced χ²", value: 1.25 });
  });
});

describe("reflFitRecord — history on the datasets", () => {
  it("puts a record at the head of every channel dataset's history, capped", () => {
    const rec = makeRecord({}, ["pp", "mm"]);
    let datasets = [ds("pp"), ds("mm"), ds("other")];
    datasets = withFitRecord(datasets, rec);
    expect(recordsFor(datasets[0]).map((r) => r.id)).toEqual([rec.id]);
    expect(recordsFor(datasets[1]).map((r) => r.id)).toEqual([rec.id]);
    expect(datasets[2].reflFits).toBeUndefined();

    for (let i = 2; i <= HISTORY_LIMIT + 3; i++) {
      datasets = withFitRecord(datasets, makeRecord({ id: `rfit-${i}`, seq: i }, ["pp", "mm"]));
    }
    const ids = recordsFor(datasets[0]).map((r) => r.id);
    expect(ids).toHaveLength(HISTORY_LIMIT);
    expect(ids[0]).toBe(`rfit-${HISTORY_LIMIT + 3}`); // newest first
    expect(nextSeq(datasets, ["pp"])).toBe(HISTORY_LIMIT + 4);
    expect(nextSeq(datasets, ["other"])).toBe(1);
  });

  it("is a no-op (same array) when none of the record's datasets exists", () => {
    const datasets = [ds("other")];
    expect(withFitRecord(datasets, makeRecord())).toBe(datasets);
  });

  it("does not present a record whose channels name another dataset (a copied dataset)", () => {
    const copy = ds("copy", [encodeRecord(makeRecord())]); // the record names "xrr"
    expect(recordsFor(copy)).toEqual([]);
  });

  it("mints ids from the shared sequence and digests only what was sent", () => {
    expect(recordId(() => "ds-lx2-17")).toBe("rfit-lx2-17");
    const ch = { q: [0.01, 0.02], r: [1, 0.5], dr: null, label: "a" };
    expect(channelDigest(ch)).toBe(channelDigest({ ...ch, label: "renamed" }));
    expect(channelDigest(ch)).not.toBe(channelDigest({ ...ch, r: [1, 0.51] }));
  });
});
