import { describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { buildPolarMapRequest, guessPolarPicks, MIN_POLAR_POINTS } from "./polarMapRequest";

function pole(n = 5, chiMax = 80): DataStruct {
  const time: number[] = [];
  const values: number[][] = [];
  for (let c = 0; c < n; c++) {
    for (let p = 0; p < 36; p += 3) {
      time.push(p * 10);
      values.push([(c * chiMax) / Math.max(1, n - 1), 100 + c + p]);
    }
  }
  return { time, values, labels: ["Psi", "Intensity"], units: ["deg", "cps"], metadata: { x_column_name: "Phi" } };
}

const opts = { title: "t", filename: "f" };

describe("polar map request", () => {
  it("guesses the XRDML pole layout (Phi x, Psi, Intensity), equal-area default", () => {
    expect(guessPolarPicks(pole())).toMatchObject({ phi: -1, chi: 0, z: 1, projection: "equal_area" });
  });

  it("sends wire columns counted from the X column", () => {
    const d = pole();
    const b = buildPolarMapRequest(d, guessPolarPicks(d), opts);
    expect(b.problem).toBeNull();
    expect(b.spec?.polar?.polar_map).toMatchObject({ chi_col: 1, phi_col: 0, z_col: 2, projection: "equal_area", z_scale: "linear" });
  });

  it("refuses chi outside 0-90 and too few points", () => {
    const d = pole(5, 120);
    expect(buildPolarMapRequest(d, guessPolarPicks(d), opts).problem).toMatch(/0-90/);
    const few = pole(1, 0);
    expect(few.time.length).toBeLessThan(MIN_POLAR_POINTS * 2);
    const tiny = { ...few, time: few.time.slice(0, 4), values: few.values.slice(0, 4) };
    expect(buildPolarMapRequest(tiny, guessPolarPicks(tiny), opts).problem).toMatch(/at least/);
  });

  it("refuses duplicate column picks and counts rows with non-finite values", () => {
    const d = pole();
    expect(buildPolarMapRequest(d, { ...guessPolarPicks(d), z: 0 }, opts).problem).toMatch(/three different/);
    d.values[0][1] = NaN;
    expect(buildPolarMapRequest(d, guessPolarPicks(d), opts).dropped).toBe(1);
  });
});
