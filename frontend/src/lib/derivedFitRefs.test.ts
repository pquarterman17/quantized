// P2.5 fitted-value use (lib/derivedFitRefs.ts) — the store-independent core
// of a fit refresh: resnapping existing snapshots, resolving newly
// introduced ones (review finding 4), and doing both through the single
// recomputeWithErrors path so a recode column's level_order survives
// (review finding 7).

import { describe, expect, it } from "vitest";

import { refreshFitRefs, resolveFits } from "./derivedFitRefs";
import { parseExpr } from "./derivedExprAst";
import type { ComputedColumn, Dataset } from "./types";

const lin: ComputedColumn["derived"] = { fits: [{ model: "Linear", paramNames: ["m", "b"], params: [2, 1] }] };

function ds(over: Partial<Dataset> = {}): Dataset {
  return {
    id: "d",
    name: "d",
    fitSpec: { model: "Linear", params: [2, 1], exitFlag: 1 },
    data: {
      time: [0, 1, 2],
      values: [
        [0, 0, 0],
        [1, 1, 2],
        [0, 0, 4],
      ],
      labels: ["A", "R", "k"],
      units: ["", "", ""],
      metadata: {},
      cat_levels: { 0: ["Bravo", "Alpha"], 1: ["Bravo", "Alpha"] },
      level_order: { 1: [1, 0] },
    },
    formulas: [
      { name: "R", expr: "recode(A)", deps: ["A"], recode: { sourceLetter: "A", mapping: { groups: [] } } },
      { name: "k", expr: 'fit("Linear", "m") * A', deps: ["A"], derived: lin },
    ],
    ...over,
  };
}

describe("refreshFitRefs (review finding 7: recomputeWithErrors, not a hand-rolled pair)", () => {
  it("a recode column's level_order survives a refit", () => {
    const d = ds({ fitSpec: { model: "Linear", params: [5, 0], exitFlag: 1 } }); // refit changed params
    const next = refreshFitRefs(d);
    expect(next).not.toBe(d); // the snapshot resnapped, so this DID recompute
    expect(next.data.values.map((r) => r[2])).toEqual([0, 5, 0]); // k = 5*A
    expect(next.data.level_order).toEqual({ 1: [1, 0] }); // the recode's order was NOT dropped
  });

  it("a refit that resnaps to the SAME params writes nothing at all", () => {
    const d = ds();
    expect(refreshFitRefs(d)).toBe(d);
  });
});

describe("resolveFits (review finding 4's shared first-resolution pass)", () => {
  it("resolves a fit()/fitval() reference fresh against the CURRENT saved fit", () => {
    const d = ds();
    const r = resolveFits(d, parseExpr('A - fitval("Linear", x)'));
    expect(r).toEqual({ fits: [{ model: "Linear", paramNames: ["m", "b"], params: [2, 1], expr: "p0*x + p1" }] });
  });

  it("an unresolvable model (no saved fit) reports why, not a crash", () => {
    const d = ds({ fitSpec: undefined });
    const r = resolveFits(d, parseExpr('fit("Linear", "m")'));
    expect(r).toEqual({ error: 'fit("Linear"): this dataset has no saved fit' });
  });
});
