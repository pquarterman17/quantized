import { describe, expect, it } from "vitest";

import { cutName, cutSpaceForKeys, lineCutBody, segCutBody } from "./mapcuts";
import type { DataStruct } from "./types";

const ds: DataStruct = {
  time: [0, 1],
  values: [
    [1, 2, 3],
    [4, 5, 6],
  ],
  labels: ["2Theta", "Omega", "Intensity"],
  units: ["deg", "deg", "cps"],
  metadata: { is2D: true },
};

describe("cutSpaceForKeys", () => {
  it("angular / q / neither", () => {
    expect(cutSpaceForKeys(true, false)).toBe("angular");
    expect(cutSpaceForKeys(false, true)).toBe("q");
    expect(cutSpaceForKeys(false, false)).toBeNull();
  });
});

describe("lineCutBody", () => {
  it("an H-cut fixes the vertical axis value; V-cut the horizontal", () => {
    const h = lineCutBody(ds, "h", { x: 44.0, y: 21.5 }, "angular", 0.2);
    expect(h.direction).toBe("h");
    expect(h.value).toBe(21.5);
    expect(h.width).toBe(0.2);
    const v = lineCutBody(ds, "v", { x: 44.0, y: 21.5 }, "q", 0);
    expect(v.value).toBe(44.0);
    expect(v.space).toBe("q");
  });
});

describe("segCutBody", () => {
  it("builds the p0/p1 request and rejects a zero-length drag", () => {
    const body = segCutBody(ds, { x: 1, y: 2 }, { x: 3, y: 4 }, "angular", 0.1);
    expect(body).not.toBeNull();
    expect(body?.p0).toEqual([1, 2]);
    expect(body?.p1).toEqual([3, 4]);
    expect(segCutBody(ds, { x: 1, y: 2 }, { x: 1, y: 2 }, "angular", 0)).toBeNull();
  });
});

describe("cutName", () => {
  it("uses cut_label metadata with a fallback", () => {
    expect(cutName({ ...ds, metadata: { cut_label: "H-cut Omega≈21.5 deg" } })).toBe(
      "H-cut Omega≈21.5 deg",
    );
    expect(cutName(ds)).toBe("line cut");
  });
});
