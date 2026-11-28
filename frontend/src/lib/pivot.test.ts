// The pivot rules against pandas, through the shared fixture tests/fixtures/wire/pivot.json (written
// by tests/test_pivot_fixture.py, which asserts the file IS pandas's answer). Missing cells are null
// there and NaN here.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { meltWideToLong, pivotLongToWide, type PivotRule } from "./pivot";

type Cell = number | null;
interface Fixture {
  [name: string]: {
    long?: { t: number[]; k: string[]; v: Cell[] };
    wide?: { t: number[]; a: Cell[]; b: Cell[] };
    rule?: PivotRule;
    skipEmpty?: boolean;
    expect: { error?: boolean; time?: number[]; keys?: string[]; values?: Cell[][]; key?: string[]; value?: Cell[] };
  };
}

const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../tests/fixtures/wire/pivot.json"), "utf8")) as Fixture;
const nan = (v: Cell): number => (v === null ? Number.NaN : v);
const orNull = (v: number): Cell => (Number.isNaN(v) ? null : v);

describe("pivot against pandas", () => {
  for (const [name, c] of Object.entries(fixture).filter(([n]) => n.startsWith("pivot_"))) {
    it(name, () => {
      const rows = { time: c.long!.t, key: c.long!.k, value: c.long!.v.map(nan) };
      // pandas sorts the keys; the fixture's own column order is the order under test.
      const keyOrder = c.expect.error ? [...new Set(c.long!.k)].sort() : c.expect.keys!;
      const out = pivotLongToWide(rows, keyOrder, c.rule!);
      if (c.expect.error) {
        expect("error" in out && out.error).toMatch(/more than one row/);
        return;
      }
      if ("error" in out) throw new Error(out.error);
      expect(out.time).toEqual(c.expect.time);
      expect(out.keys).toEqual(c.expect.keys);
      expect(out.values.map((r) => r.map(orNull))).toEqual(c.expect.values);
    });
  }

  for (const [name, c] of Object.entries(fixture).filter(([n]) => n.startsWith("melt_"))) {
    it(name, () => {
      const w = c.wide!;
      const long = meltWideToLong(w.t, w.t.map((_, i) => [nan(w.a[i]), nan(w.b[i])]), [{ index: 0, label: "a" }, { index: 1, label: "b" }], c.skipEmpty!);
      expect(long.time).toEqual(c.expect.time);
      expect(long.key.map((k) => long.keys[k])).toEqual(c.expect.key);
      expect(long.value.map(orNull)).toEqual(c.expect.value);
    });
  }
});

describe("pivot edge rules", () => {
  it("leaves out rows whose time or key is missing and counts them", () => {
    const out = pivotLongToWide({ time: [1, Number.NaN, 2], key: ["a", "a", null], value: [1, 2, 3] }, ["a"], "refuse");
    if ("error" in out) throw new Error(out.error);
    expect(out.skipped).toBe(2);
    expect(out.values).toEqual([[1]]);
  });

  it("long to wide to long keeps every present value", () => {
    const rows = { time: [1, 1, 2], key: ["a", "b", "a"], value: [10, 20, 30] };
    const wide = pivotLongToWide(rows, ["a", "b"], "refuse");
    if ("error" in wide) throw new Error(wide.error);
    const back = meltWideToLong(wide.time, wide.values, wide.keys.map((label, index) => ({ index, label })), true);
    const triples = back.time.map((t, i) => `${t}|${back.keys[back.key[i]]}|${back.value[i]}`).sort();
    expect(triples).toEqual(["1|a|10", "1|b|20", "2|a|30"]);
  });
});
