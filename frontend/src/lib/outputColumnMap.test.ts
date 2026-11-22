import { describe, expect, it } from "vitest";

import { planColumnMapByName } from "./outputColumnMap";

describe("planColumnMapByName", () => {
  it("every permutation / drop / add lands each kept column on its new index", () => {
    const old = ["a", "b", "c", "d"];
    const news = [["d", "c", "b", "a"], ["b", "x", "a"], ["c", "d", "a", "b", "y", "z"], ["a"], ["x", "y"], []];
    for (const next of news) {
      const plan = planColumnMapByName(old, next, new Set());
      if (!plan.ok) throw new Error("unbound columns never block");
      old.forEach((label, c) => {
        const at = next.indexOf(label);
        expect(plan.map(c)).toBe(at < 0 ? null : at);
      });
    }
  });

  it("names a bound column that vanished, or whose label is not unique", () => {
    expect(planColumnMapByName(["a", "b"], ["a"], new Set([1]))).toEqual({ ok: false, problems: [{ col: 1, label: "b", kind: "removed" }] });
    expect(planColumnMapByName(["a", "b"], ["b", "b"], new Set([1]))).toEqual({ ok: false, problems: [{ col: 1, label: "b", kind: "duplicate" }] });
    expect(planColumnMapByName(["a", "a"], ["a"], new Set([0]))).toMatchObject({ ok: false });
    expect(planColumnMapByName(["a", "a", "b"], ["b"], new Set([2]))).toMatchObject({ ok: true });
  });
});
