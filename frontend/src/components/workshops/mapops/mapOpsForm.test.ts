import { describe, expect, it } from "vitest";

import { buildRequest, emptyForm, opLabel } from "./mapOpsForm";

describe("buildRequest", () => {
  it("crop: empty bounds are unbounded, junk and all-empty are refused", () => {
    expect(buildRequest({ ...emptyForm(), op: "crop", xmin: "1", ymax: "5" }).req).toEqual({ op: "crop", xmin: 1, xmax: null, ymin: null, ymax: 5 });
    expect(buildRequest({ ...emptyForm(), op: "crop", xmin: "abc" }).error).toMatch(/numbers/);
    expect(buildRequest({ ...emptyForm(), op: "crop" }).error).toMatch(/at least one/);
  });

  it("geometry ops", () => {
    expect(buildRequest({ ...emptyForm(), op: "flip", flipAxis: "v" }).req).toEqual({ op: "flip", axis: "v" });
    expect(buildRequest({ ...emptyForm(), op: "rotate", degrees: "270" }).req).toEqual({ op: "rotate", degrees: 270 });
    expect(buildRequest({ ...emptyForm(), op: "transpose" }).req).toEqual({ op: "transpose" });
    expect(buildRequest({ ...emptyForm(), op: "level", order: "2", restoreMean: true }).req).toEqual({ op: "plane_level", order: 2, restore_mean: true });
  });

  it("arithmetic needs map B; scalar needs a number", () => {
    expect(buildRequest({ ...emptyForm(), op: "arith" }).error).toMatch(/second map/);
    const ok = buildRequest({ ...emptyForm(), op: "arith", otherId: "b", arith: "div", interpolate: true });
    expect(ok.req).toEqual({ op: "arith", arith: "div", interpolate: true, allow_mismatch: false });
    expect(buildRequest({ ...emptyForm(), op: "scalar", scalar: "" }).error).toMatch(/number/);
    expect(buildRequest({ ...emptyForm(), op: "scalar", scalar: "2.5", arith: "mul", reverse: true }).req).toEqual({ op: "scalar", arith: "mul", value: 2.5, reverse: true });
  });

  it("names the result by its operation", () => {
    expect(opLabel({ ...emptyForm(), op: "rotate", degrees: "90" })).toBe("rotate 90°");
    expect(opLabel({ ...emptyForm(), op: "arith", arith: "sub" }, "dark.xrdml")).toBe("A − dark.xrdml");
    expect(opLabel({ ...emptyForm(), op: "scalar", arith: "div", scalar: "4", reverse: true })).toBe("4 ÷ A");
  });
});
