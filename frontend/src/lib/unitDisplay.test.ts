// Units are spelled typographically in axis titles and legends ("cm^-1" ->
// "cm⁻¹"), on the canvas and in the vector export alike. The cases live in a
// SHARED wire fixture (`tests/fixtures/wire/unit_display.json`) that the
// export leg (`tests/test_unit_display.py`) reads too.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { PlotPayload } from "./plotdata";
import { seriesDisplayLabel } from "./seriesDisplayLabel";
import { sharedAxisTitle } from "./sharedAxisTitle";
import { displayUnit, withUnit } from "./unitDisplay";
import { buildOpts } from "./uplotOpts";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "unit_display.json",
);
const CASES = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: { unit: string; display: string }[] }).cases;

describe("displayUnit (shared wire fixture)", () => {
  it.each(CASES.map((c) => [c.unit || "<empty>", c] as const))("%s", (_name, c) => {
    expect(displayUnit(c.unit)).toBe(c.display);
  });

  it("withUnit composes the display spelling", () => {
    expect(withUnit("Wavenumber", "cm^-1")).toBe("Wavenumber (cm⁻¹)");
    expect(withUnit("Transmittance", "")).toBe("Transmittance");
  });
});

describe("plot titles and legends spell the unit", () => {
  const base = { width: 400, height: 300, xScale: "linear" as const, yScale: "linear" as const, tool: "zoom" as const, onReadout: () => {} };
  const payload = (series: PlotPayload["series"]): PlotPayload => ({
    data: [[0, 1], ...series.map(() => [1, 2])],
    series,
    xLabel: "Wavenumber",
    xUnit: "cm^-1",
  });

  it("x title, solo y title and legend", () => {
    const opts = buildOpts(payload([{ label: "Mag", unit: "emu/cm^3" }]), base);
    expect(opts.axes?.[0]?.label).toBe("Wavenumber (cm⁻¹)");
    expect(opts.axes?.[1]?.label).toBe("Mag (emu/cm³)");
    expect(opts.series[1]?.label).toBe("Mag (emu/cm³)");
  });

  it("a shared y title, and a rename stays verbatim", () => {
    expect(sharedAxisTitle([{ label: "Qz", unit: "Ang^-1" }, { label: "Qz", unit: "Ang^-1" }])).toBe("Qz (Å⁻¹)");
    expect(seriesDisplayLabel("Mag", "emu/cm^3", undefined)).toBe("Mag (emu/cm³)");
    expect(seriesDisplayLabel("Mag", "emu/cm^3", "M (emu/cm^3)")).toBe("M (emu/cm^3)");
  });
});
