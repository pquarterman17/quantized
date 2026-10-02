import { describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { defaultForm, formToParams, guessReference, type SimsForm } from "./simsForm";

const data: DataStruct = {
  time: [0, 1, 2],
  values: [[10, 1e5, 3], [20, 2e5, 4], [5, 1e5, null as unknown as number]],
  labels: ["B", "Si", "P"],
  units: ["c/s", "c/s", "c/s"],
  metadata: {},
};
const labels = data.labels;
const form = (patch: Partial<SimsForm>): SimsForm => ({ ...defaultForm(data), ...patch });

describe("simsForm", () => {
  it("guesses the matrix species as the largest median signal", () => {
    expect(guessReference(data)).toBe("Si");
    expect(defaultForm(data).reference).toBe("Si");
    expect(guessReference(undefined)).toBe("");
  });

  it("asks for at least one step, and names what is missing per stage", () => {
    expect(formToParams(form({}), labels)).toBe("Turn on at least one step.");
    expect(formToParams(form({ calOn: true, calMethod: "rate" }), labels)).toMatch(/sputter rate/);
    expect(formToParams(form({ calOn: true, craterDepth: "-1" }), labels)).toMatch(/crater depth/);
    expect(formToParams(form({ calOn: true, craterDepth: "500", totalTime: "abc" }), labels)).toMatch(/total sputter time/);
    expect(formToParams(form({ calOn: true, calMethod: "scale", scaleValue: "0" }), labels)).toMatch(/multiplier/);
    expect(formToParams(form({ calOn: true, calMethod: "scale", scaleMode: "divide", scaleValue: "0" }), labels)).toMatch(/divisor/);
    expect(formToParams(form({ calOn: true, calMethod: "scale", scaleMode: "divide", scaleValue: "5e-324" }), labels)).toMatch(/numeric range/);
    expect(formToParams(form({ calOn: true, calMethod: "scale", offset: "nope" }), labels)).toMatch(/offset/);
    expect(formToParams(form({ bgOn: true, bgLo: "1" }), labels)).toMatch(/both limits/);
    expect(formToParams(form({ normOn: true, reference: "O" }), labels)).toMatch(/reference/);
    expect(formToParams(form({ normOn: true, rsf: { B: "0" } }), labels)).toMatch(/RSF for B/);
    expect(formToParams(form({ normOn: true, rsf: { B: "1e20" }, rsfUnit: " " }), labels)).toMatch(/unit the RSFs/);
    expect(formToParams(form({ smoothOn: true, window: "1.5" }), labels)).toMatch(/half-width/);
    expect(formToParams(form({ smoothOn: true, smoothMethod: "savitzky-golay", window: "1", polyOrder: "3" }), labels)).toMatch(/below the window width \(3\)/);
  });

  it("keeps the likely matrix out of the background by default; an empty keep-list is omitted", () => {
    expect(defaultForm(data).bgKeep).toEqual(["Si"]);
    expect(formToParams(form({ bgOn: true, bgLo: "0", bgHi: "1", bgKeep: ["O"] }), labels)).toEqual({
      op: "sims",
      background: { lo: 0, hi: 1 },
    });
  });

  it("builds the recorded params; blank RSFs and the reference's own RSF are left out", () => {
    const p = formToParams(
      form({
        calOn: true,
        craterDepth: "1.5",
        craterUnit: "um",
        totalTime: "600",
        timeUnit: "s",
        bgOn: true,
        bgLo: "1400",
        bgHi: "1500",
        normOn: true,
        rsf: { B: "2e21", P: " ", Si: "9" },
        smoothOn: true,
        window: "3",
      }),
      labels,
    );
    expect(p).toEqual({
      op: "sims",
      calibration: { method: "crater", craterDepth: 1.5, craterUnit: "um", totalTime: 600, depthUnit: "nm", timeUnit: "s" },
      background: { lo: 1400, hi: 1500, keep: ["Si"] },
      normalization: { reference: "Si", rsf: { B: 2e21 }, rsfUnit: "atoms/cm3" },
      smoothing: { method: "moving", window: 3, polyOrder: 2 },
    });
    expect(formToParams(form({ calOn: true, calMethod: "rate", sputterRate: "0.4", rateLen: "A", rateTime: "min" }), labels)).toEqual({
      op: "sims",
      calibration: { method: "rate", sputterRate: 0.4, rateUnit: "A/min", depthUnit: "nm" },
    });
    expect(formToParams(form({ calOn: true, calMethod: "scale", scaleMode: "divide", scaleValue: "1000", offset: "-2", depthUnit: "um" }), labels)).toEqual({
      op: "sims",
      calibration: { method: "scale", scaleFactor: 0.001, offset: -2, depthUnit: "um" },
    });
    expect(formToParams(form({ normOn: true }), labels)).toEqual({ op: "sims", normalization: { reference: "Si" } });
  });
});
