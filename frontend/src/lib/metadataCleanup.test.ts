// P2.5 "Metadata cleanup": synonym merge (with disagreement refusal), trim /
// case, the unit parse and its ambiguity refusals, and the provenance log that
// keeps every original value.

import { describe, expect, it } from "vitest";

import { applyCleanup, parseQuantity, planCleanup, type CleanupPlan } from "./metadataCleanup";

const t = (id: string, metadata: Record<string, unknown>) => ({ id, name: id, data: { metadata } });
const none: CleanupPlan = { unify: [], normalize: [] };

describe("unify synonyms", () => {
  it("merges Temp / temperature / a sidecar T_set into one key, renaming top-level sources away", () => {
    const res = planCleanup(
      [t("a", { Temp: "300 K" }), t("b", { temperature: 310 }), t("c", { header_fields: { T_set: "5 K" } }), t("d", { other: 1 })],
      { ...none, unify: [{ to: "temperature", from: [["Temp"], ["header_fields", "T_set"]] }] },
    );
    expect(res.refusals).toEqual([]);
    const by = Object.fromEntries(res.datasets.map((d) => [d.id, d.changes]));
    expect(by.a).toEqual([
      { key: "temperature", before: undefined, after: "300 K", note: "from Temp" },
      { key: "Temp", before: "300 K", after: undefined, note: "renamed to temperature" },
    ]);
    expect(by.b).toBeUndefined(); // already the target key: nothing to change
    // a sidecar source is COPIED, never deleted from the instrument dict
    expect(by.c).toEqual([{ key: "temperature", before: undefined, after: "5 K", note: "from header_fields › T_set" }]);
    expect(by.d).toBeUndefined();
  });

  it("refuses a dataset whose synonyms disagree instead of picking a winner", () => {
    const res = planCleanup([t("a", { Temp: "300", T_set: "310" }), t("b", { Temp: "5", T_set: " 5 " })], {
      ...none,
      unify: [{ to: "temperature", from: [["Temp"], ["T_set"]] }],
    });
    expect(res.refusals).toEqual(["a: Temp (300) and T_set (310) disagree — not unified."]);
    expect(res.datasets.map((d) => d.id)).toEqual(["b"]); // equal after trimming: merged
    expect(res.datasets[0].changes.map((c) => [c.key, c.after])).toEqual([["temperature", "5"], ["Temp", undefined], ["T_set", undefined]]);
  });

  it("never overwrites a collection with the unified value", () => {
    const res = planCleanup([t("a", { Temp: "1", instrument: { x: 1 } })], { ...none, unify: [{ to: "instrument", from: [["Temp"]] }] });
    expect(res.datasets).toEqual([]);
    expect(res.refusals[0]).toMatch(/already holds a collection/);
  });

  it("moves a renamed top-level key's <key>_unit sibling along with it", () => {
    const res = planCleanup([t("a", { Temp: "300", Temp_unit: "K" })], { ...none, unify: [{ to: "temperature", from: [["Temp"]] }] });
    expect(res.refusals).toEqual([]);
    expect(res.datasets[0].changes).toEqual([
      { key: "temperature", before: undefined, after: "300", note: "from Temp" },
      { key: "Temp", before: "300", after: undefined, note: "renamed to temperature" },
      { key: "temperature_unit", before: undefined, after: "K", note: "unit moved" },
      { key: "Temp_unit", before: "K", after: undefined, note: "renamed to temperature_unit" },
    ]);
  });

  it("refuses a rename whose unit siblings disagree, orphaning neither", () => {
    const res = planCleanup([t("a", { Temp: "300", Temp_unit: "K", temperature: "300", temperature_unit: "C" })], {
      ...none,
      unify: [{ to: "temperature", from: [["Temp"]] }],
    });
    expect(res.datasets).toEqual([]); // nothing touched — not the value, not either unit
    expect(res.refusals).toEqual(["a: Temp_unit (K) and temperature_unit (C) disagree — “temperature” not unified."]);
  });

  it("refuses a unify target that is wiring/provenance, not metadata", () => {
    const wiring = planCleanup([t("a", { Temp: "300" })], { ...none, unify: [{ to: "x_column_name", from: [["Temp"]] }] });
    expect(wiring.datasets).toEqual([]);
    expect(wiring.refusals).toEqual(["“x_column_name” is a wiring/provenance key, not metadata — not unified."]);

    const origin = planCleanup([t("a", { Temp: "300" })], { ...none, unify: [{ to: "origin_notes", from: [["Temp"]] }] });
    expect(origin.datasets).toEqual([]);
    expect(origin.refusals[0]).toMatch(/“origin_notes” is a wiring\/provenance key/);
  });
});

describe("normalize values", () => {
  it("trims and collapses whitespace, and changes case", () => {
    const res = planCleanup([t("a", { op: "  Paige   Q " }), t("b", { op: "pq" })], {
      ...none,
      normalize: [{ key: "op", trim: true, letterCase: "upper", units: false }],
    });
    expect(res.datasets.map((d) => d.changes.map((c) => c.after))).toEqual([["PAIGE Q"], ["PQ"]]);
  });

  it('parses "300 K" to 300 with unit K where every value agrees', () => {
    const res = planCleanup([t("a", { T: "300 K" }), t("b", { T: "4.2K" })], {
      ...none,
      normalize: [{ key: "T", trim: true, letterCase: "keep", units: true }],
    });
    expect(res.refusals).toEqual([]);
    expect(res.datasets[0].changes).toEqual([
      { key: "T", before: "300 K", after: 300, note: "parsed number (unit K)" },
      { key: "T_unit", before: undefined, after: "K", note: "unit parsed from T" },
    ]);
    expect(res.datasets[1].changes[0].after).toBe(4.2);
  });

  it("refuses the unit parse whenever it would have to guess (values keep their text)", () => {
    const run = (vals: unknown[]) =>
      planCleanup(vals.map((v, i) => t(`d${i}`, { T: v })), { ...none, normalize: [{ key: "T", trim: true, letterCase: "keep", units: true }] });
    expect(run(["300 K", "27 C"]).refusals).toEqual(["T: the units differ (K, C) — units not parsed."]);
    expect(run(["300 K", "300"]).refusals).toEqual(["T: the units differ (K, none) — units not parsed."]);
    expect(run(["1,5 K"]).refusals[0]).toMatch(/comma/);
    expect(run(["300-310 K"]).refusals[0]).toMatch(/not a single number with a unit/);
    expect(run(["~300 K"]).refusals[0]).toMatch(/not a single number/);
    const refused = run(["300 K", "27 C "]);
    expect(refused.datasets.map((d) => d.changes.map((c) => c.after))).toEqual([["27 C"]]); // trim only
    expect(parseQuantity(12)).toEqual({ n: 12, unit: "" });
  });

  it("refuses a non-finite quantity (\"1e999\" overflows to Infinity) rather than parse it", () => {
    expect(parseQuantity("1e999 K")).toEqual({ error: "is not a finite number" });
    expect(parseQuantity(Number.POSITIVE_INFINITY)).toEqual({ error: "is not a finite number" });
    const res = planCleanup([t("a", { T: "1e999 K" })], { ...none, normalize: [{ key: "T", trim: true, letterCase: "keep", units: true }] });
    expect(res.refusals[0]).toMatch(/1e999 K.*is not a finite number/);
    expect(res.datasets).toEqual([]); // already trimmed: refusing the unit parse leaves nothing else to change
  });

  it("an already-parsed number counts with the unit its <key>_unit records", () => {
    const res = planCleanup([t("a", { T: 300, T_unit: "K" }), t("b", { T: "10 K" })], {
      ...none,
      normalize: [{ key: "T", trim: true, letterCase: "keep", units: true }],
    });
    expect(res.refusals).toEqual([]);
    expect(res.datasets.map((d) => [d.id, d.changes.map((c) => [c.key, c.after])])).toEqual([["b", [["T", 10], ["T_unit", "K"]]]]);
  });

  it("refuses a parsed unit that contradicts an existing <key>_unit", () => {
    const res = planCleanup([t("a", { T: "300 K", T_unit: "C" })], { ...none, normalize: [{ key: "T", trim: false, letterCase: "keep", units: true }] });
    expect(res.refusals[0]).toMatch(/already has T_unit = “C”/);
    expect(res.datasets).toEqual([]);
  });

  it("normalizes a key a unify rule in the same plan created", () => {
    const res = planCleanup([t("a", { Temp: " 300 K " })], {
      unify: [{ to: "temperature", from: [["Temp"]] }],
      normalize: [{ key: "temperature", trim: true, letterCase: "keep", units: true }],
    });
    expect(res.datasets[0].changes.map((c) => [c.key, c.before, c.after])).toEqual([
      ["temperature", undefined, 300],
      ["Temp", " 300 K ", undefined],
      ["temperature_unit", undefined, "K"],
    ]);
  });
});

describe("applyCleanup", () => {
  it("writes the changes and logs every before value, appending to an earlier log", () => {
    const meta = { Temp: "300 K", keep: 1, metadata_cleanup: [{ key: "x", before: 1, after: 2, note: "old", at: "t0" }] };
    const [d] = planCleanup([t("a", meta)], { ...none, unify: [{ to: "temperature", from: [["Temp"]] }] }).datasets;
    const out = applyCleanup(meta, d.changes, "t1");
    expect(out).toMatchObject({ temperature: "300 K", keep: 1 });
    expect("Temp" in out).toBe(false);
    expect(out.metadata_cleanup).toEqual([
      { key: "x", before: 1, after: 2, note: "old", at: "t0" },
      { key: "temperature", before: null, after: "300 K", note: "from Temp", at: "t1" },
      { key: "Temp", before: "300 K", after: null, note: "renamed to temperature", at: "t1" },
    ]);
    expect(meta.Temp).toBe("300 K"); // the input is not mutated
  });
});
