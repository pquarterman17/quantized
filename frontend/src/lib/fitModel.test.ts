import { describe, expect, it } from "vitest";

import {
  addMainEffects, buildFitModelBody, crossTerms, fullFactorial, modelColumns, modelProblem,
  polynomialDegree2, removeTerms, termKey, termLabel,
} from "./fitModel";
import type { DataStruct } from "./types";

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4],
  values: [[0, 500, 3.9], [1, 600, 4.0], [0, 700, NaN], [1, 550, 4.1], [NaN, 650, 4.2]],
  labels: ["sub", "T", "a"],
  units: ["", "C", "Å"],
  metadata: {},
  cat_levels: { 0: ["Si", "MgO"] },
};

describe("model building (JMP Construct Model Effects)", () => {
  it("adds main effects without duplicates and crosses order-free", () => {
    let t = addMainEffects([], [0, 1]);
    t = addMainEffects(t, [1]);
    expect(t).toEqual([[0], [1]]);
    t = crossTerms(t, [1, 0]);
    expect(crossTerms(t, [0, 1])).toEqual([[0], [1], [1, 0]]);
    expect(crossTerms(t, [0])).toEqual(t);
    expect(termKey([1, 0])).toBe(termKey([0, 1]));
  });

  it("full factorial is every subset, lowest order first", () => {
    expect(fullFactorial([], [0, 1, 2]).map((x) => x.length)).toEqual([1, 1, 1, 2, 2, 2, 3]);
  });

  it("Poly² squares and crosses only the continuous columns", () => {
    const cont = (c: number) => c !== 0;
    expect(polynomialDegree2([], [0, 1, 2], cont)).toEqual([[0], [1], [2], [1, 1], [2, 2], [1, 2]]);
  });

  it("removes by term key and lists model columns once", () => {
    const t = [[0], [1], [0, 1]];
    expect(removeTerms(t, [termKey([1, 0])])).toEqual([[0], [1]]);
    expect(modelColumns([[1, 1], [0, 1]])).toEqual([1, 0]);
    expect(termLabel([1, 1], (c) => ["sub", "T"][c]!)).toBe("T*T");
  });

  it("refuses an empty model, the response as an effect and a nominal power before any request", () => {
    const base = { responseCol: 2, kinds: { 0: "nominal" as const, 1: "continuous" as const }, center: true };
    expect(modelProblem({ ...base, terms: [] }, 3)).toMatch(/at least one effect/);
    expect(modelProblem({ ...base, terms: [[2]], kinds: { 2: "continuous" } }, 3)).toMatch(/response cannot/);
    expect(modelProblem({ ...base, terms: [[0, 0]] }, 3)).toMatch(/nominal factor cannot/);
    expect(modelProblem({ ...base, terms: [[0], [1, 1]] }, 3)).toBeNull();
    expect(modelProblem({ ...base, terms: [[5]], kinds: { 5: "continuous" } }, 3)).toMatch(/no longer exists/);
  });
});

describe("buildFitModelBody", () => {
  it("sends nominal columns as level labels in level order and missing values as null", () => {
    const body = buildFitModelBody(DATA, {
      responseCol: 2, terms: [[0], [1], [0, 1]], kinds: { 0: "nominal", 1: "continuous" }, center: false,
    }, (c) => DATA.labels[c]!);
    expect(body.response_name).toBe("a");
    expect(body.response).toEqual([3.9, 4.0, null, 4.1, 4.2]);
    expect(body.factors).toEqual([
      { name: "sub", kind: "nominal", values: ["Si", "MgO", "Si", "MgO", null], levels: ["Si", "MgO"] },
      { name: "T", kind: "continuous", values: [500, 600, 700, 550, 650] },
    ]);
    expect(body.terms).toEqual([["sub"], ["T"], ["sub", "T"]]);
    expect(body.center_polynomials).toBe(false);
  });

  it("keeps two columns with one label as two factors", () => {
    const body = buildFitModelBody(DATA, {
      responseCol: 2, terms: [[0], [1]], kinds: { 0: "continuous", 1: "continuous" }, center: true,
    }, () => "same");
    expect(body.factors.map((f) => f.name)).toEqual(["same", "same′"]);
    expect(body.terms).toEqual([["same"], ["same′"]]);
  });
});
