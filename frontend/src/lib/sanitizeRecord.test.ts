// Direct coverage for the ONE record sanitizer every restore path shares
// (BUG-014 round 4 added it; round 5 split its key policy in two). Until now
// it was exercised only THROUGH its three callers, so the behaviour its own
// header singles out — which variant normalizes a non-canonical numeric key
// like `"01"` and which leaves it verbatim — was asserted nowhere, and the
// round-4 commit body made a claim about `"01"` that the technique-memory
// path did not actually have.

import { describe, expect, it } from "vitest";

import { isFiniteNumber, isString, keyedRecord, numKeyedRecord } from "./sanitizeRecord";

describe("keyedRecord — values validated, keys VERBATIM", () => {
  it("keeps only entries whose value passes the guard", () => {
    // The bug this exists for: a number surviving into `seriesLabels` reached
    // `lib/richtext.hasMarkup` and threw `s.includes is not a function`.
    expect(keyedRecord({ a: "ok", b: 42, c: null, d: ["x"], e: "" }, isString)).toEqual({ a: "ok", e: "" });
  });

  it("leaves a non-canonical numeric key EXACTLY as written", () => {
    // `lib/plotview.ts`'s `seriesLabels` is read as `seriesLabels[ch]` with a
    // real number, so `"01"` must stay `"01"` and miss rather than be
    // silently relocated onto channel 1.
    const out = keyedRecord<string, number>({ "1": "D", "01": "A", "-1": "B" }, isString);
    expect(Object.keys(out)).toEqual(["1", "01", "-1"]);
    expect(out[1]).toBe("D");
    expect((out as Record<string, string>)["01"]).toBe("A");
  });

  it("degrades a non-object to an empty map instead of throwing", () => {
    for (const v of [null, undefined, 42, "str", true]) expect(keyedRecord(v, isString)).toEqual({});
  });

  it("preserves the object's own key order", () => {
    expect(Object.keys(keyedRecord({ z: "1", a: "2", m: "3" }, isString))).toEqual(["z", "a", "m"]);
  });
});

describe("numKeyedRecord — values validated, keys NORMALIZED through Number", () => {
  it("relocates a non-canonical numeric key onto its channel", () => {
    // The technique-memory policy: `labels` is read by numeric index
    // (`remembered.labels[ch]`), which is what the pre-BUG-014 `strRecord`
    // guaranteed with `out[Number(k)] = val`.
    const out = numKeyedRecord({ "01": "Signal", " 2 ": "Aux" }, isString);
    expect(out[1]).toBe("Signal");
    expect(out[2]).toBe("Aux");
    expect(Object.keys(out)).toEqual(["1", "2"]);
  });

  it("drops a key that is not a finite number at all", () => {
    // `Number("x")` is NaN; parking the entry under a `"NaN"` key (what the
    // old helper did) can never match a channel, so drop it outright.
    const out = numKeyedRecord({ x: "gone", "1": "kept", Infinity: "gone too" }, isString);
    expect(out).toEqual({ 1: "kept" });
  });

  it("applies the same value guard as keyedRecord", () => {
    expect(numKeyedRecord({ "0": "ok", "1": 42, "2": null }, isString)).toEqual({ 0: "ok" });
  });

  it("validates a numeric map with isFiniteNumber", () => {
    expect(numKeyedRecord({ "1": 3, "2": NaN, "3": Infinity, "4": "3" }, isFiniteNumber)).toEqual({ 1: 3 });
  });

  it("degrades a non-object to an empty map instead of throwing", () => {
    for (const v of [null, undefined, 42, "str", true]) expect(numKeyedRecord(v, isString)).toEqual({});
  });
});
