import { describe, expect, it } from "vitest";

import { absencesNote, braggD, parsePeakList } from "./xrdIndex";

describe("xrdIndex helpers", () => {
  it("braggD is λ/(2 sin θ) and null outside (0, 180)", () => {
    // Si (220): 2θ = 47.3023° → d = 1.5406 / (2·sin 23.65115°) = 1.92015 Å
    expect(braggD(47.3023, 1.5406)).toBeCloseTo(1.92015, 5);
    expect(braggD(0, 1.5406)).toBeNull();
    expect(braggD(180, 1.5406)).toBeNull();
    expect(braggD(30, 0)).toBeNull();
  });

  it("parsePeakList accepts comma/space/semicolon lists and names a bad token", () => {
    expect(parsePeakList(" 28.44, 47.3;56.12  69.13 ")).toEqual({ peaks: [28.44, 47.3, 56.12, 69.13] });
    expect(parsePeakList("")).toEqual({ peaks: [] });
    expect(parsePeakList("28.4, 190")).toEqual({ problem: '"190" is not a 2θ position between 0 and 180°.' });
  });

  it("only lattice-only absences carry a warning", () => {
    expect(absencesNote("structure factor")).toBeNull();
    expect(absencesNote("space group")).toBeNull();
    expect(absencesNote("lattice")).toMatch(/glide\/screw/);
  });
});
