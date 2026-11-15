import { describe, expect, it } from "vitest";

import {
  functionDataStruct,
  functionParams,
  functionPlotProblem,
  readFunctionDef,
  sampleFunction,
  stripLhs,
} from "./functionPlot";

describe("functionPlot", () => {
  it("finds the free parameters in order, ignoring x, functions and constants", () => {
    expect(functionParams("y = a*sin(b*x) + c + pi")).toEqual({ params: ["a", "b", "c"], error: null });
    expect(stripLhs("f(x) = 2*x")).toBe("2*x");
    expect(stripLhs("x == 2")).toBe("x == 2");
  });

  it("reports a parse error instead of throwing", () => {
    expect(functionParams("a*(").error).toBeTruthy();
    expect(functionParams("   ").error).toMatch(/enter an expression/);
    expect(functionParams("nosuchfn(x)").error).toMatch(/unknown function/);
  });

  it("samples y = a*x^2 + b on an even grid with both ends included", () => {
    const { x, y } = sampleFunction({ expr: "a*x^2+b", params: { a: 2, b: 1 }, xMin: -1, xMax: 1, n: 5 });
    expect(x).toEqual([-1, -0.5, 0, 0.5, 1]);
    expect(y).toEqual([3, 1.5, 1, 1.5, 3]);
  });

  it("turns non-finite results into NaN gaps (1/x at 0)", () => {
    const { y } = sampleFunction({ expr: "1/x", params: {}, xMin: -1, xMax: 1, n: 3 });
    expect(y[0]).toBe(-1);
    expect(Number.isNaN(y[1])).toBe(true);
    expect(y[2]).toBe(1);
  });

  it("rejects an empty range and a bad point count", () => {
    const def = { expr: "x", params: {}, xMin: 1, xMax: 1, n: 10 };
    expect(functionPlotProblem(def)).toMatch(/x min/);
    expect(functionPlotProblem({ ...def, xMax: 2, n: 1 })).toMatch(/points/);
    expect(functionPlotProblem({ ...def, xMax: 2 })).toBeNull();
  });

  it("stores the definition on the dataset so it can be edited after reload", () => {
    const def = { expr: "a*x", params: { a: 3 }, xMin: 0, xMax: 1, n: 3 };
    const data = functionDataStruct(def);
    expect(data.values).toEqual([[0], [1.5], [3]]);
    expect(readFunctionDef({ id: "d", name: "F", data })).toEqual(def);
    expect(readFunctionDef({ id: "d", name: "F", data: { ...data, metadata: {} } })).toBeNull();
  });
});
