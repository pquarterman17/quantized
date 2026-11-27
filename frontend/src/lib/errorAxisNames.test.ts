// Pins the name conventions for the axis an error column belongs to.
import { describe, expect, it } from "vitest";
import { inferErrorBindingsFromLabels } from "./errorRoles";

const X: [string, string][] = [
  ["x_err", "x_err"], ["xerr", "xerr"], ["dx", "dx"], ["sigma_x", "sigma_x"], ["x_std", "x_std"],
  ["x_sd", "x_sd"], ["x_unc", "x_unc"], ["X.Err", "X.Err"], ["x-err", "x-err"], ["x err", "x err"],
  ["XERR", "XERR"], ["err_x", "err_x"], ["xStd", "xStd"], ["x.unc", "x.unc"], ["Sigma-X", "Sigma-X"],
];

describe("error column axis from the name", () => {
  it.each(X)("%s is an X error of y", (name) => {
    const b = inferErrorBindingsFromLabels(["y", name]);
    expect(b).toEqual([{ channel: 1, target: -1, axis: "x", side: "both" }]);
  });

  it.each(X)("%s with a y-column swapped to y spelling is a Y error", (name) => {
    const yName = name.replace(/x/g, "y").replace(/X/g, "Y");
    const b = inferErrorBindingsFromLabels(["y", yName]);
    expect(b).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
  });

  it("the xyerr2.csv shape binds x_err to x and y_err to y", () => {
    expect(inferErrorBindingsFromLabels(["y", "x_err", "y_err"])).toEqual([
      { channel: 1, target: -1, axis: "x", side: "both" },
      { channel: 2, target: 0, axis: "y", side: "both" },
    ]);
  });

  it("pairs err_<name> and <name>_err with <name>", () => {
    expect(inferErrorBindingsFromLabels(["a", "b", "err_a", "b-err"])).toEqual([
      { channel: 2, target: 0, axis: "y", side: "both" },
      { channel: 3, target: 1, axis: "y", side: "both" },
    ]);
  });

  it("a real column named x still wins as the target", () => {
    expect(inferErrorBindingsFromLabels(["x", "y", "x_err"])).toEqual([
      { channel: 2, target: 0, axis: "y", side: "both" },
    ]);
  });

  it("does not read ordinary names as axis errors", () => {
    for (const n of ["sex", "dxy", "Index", "x", "Co-Fe"]) {
      expect(inferErrorBindingsFromLabels(["y", n])).toEqual([]);
    }
  });
});
