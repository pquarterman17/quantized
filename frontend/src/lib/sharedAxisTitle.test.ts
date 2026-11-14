// A Y axis carrying several series used to show no title at all. It now
// names what the series carry, jointly: "R1, R2 (ohm)", "M (emu), T (K)"
// (gap audit 2 #11). The cases live in a SHARED wire fixture
// (`tests/fixtures/wire/shared_axis_title.json`) that the export leg
// (`tests/test_export_shared_axis_title.py`) reads too.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { PlotPayload } from "./plotdata";
import { sharedAxisTitle } from "./sharedAxisTitle";
import { buildOpts } from "./uplotOpts";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "shared_axis_title.json",
);
interface Case {
  name: string;
  series: [string, string][];
  title: string;
}
const CASES = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: Case[] }).cases;

describe("sharedAxisTitle (shared wire fixture)", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(sharedAxisTitle(c.series.map(([label, unit]) => ({ label, unit }))) ?? "").toBe(c.title);
  });

  it("no series gives no title", () => {
    expect(sharedAxisTitle([])).toBeUndefined();
  });
});

describe("buildOpts — multi-series y-axis title", () => {
  const base = { width: 400, height: 300, xScale: "linear" as const, yScale: "linear" as const, tool: "zoom" as const, onReadout: () => {} };
  const payload = (series: PlotPayload["series"]): PlotPayload => ({
    data: [[0, 1], ...series.map(() => [1, 2])],
    series,
    xLabel: "Field",
    xUnit: "Oe",
  });

  it("titles the axis with the shared quantity and unit", () => {
    const p = payload([
      { label: "Moment", unit: "emu" },
      { label: "Moment", unit: "emu" },
    ]);
    expect(buildOpts(p, base).axes?.[1]?.label).toBe("Moment (emu)");
  });

  it("names both quantities when they differ over one unit, and ignores legend renames", () => {
    const p = payload([
      { label: "R1", unit: "ohm" },
      { label: "R2", unit: "ohm" },
    ]);
    expect(buildOpts(p, { ...base, seriesLabels: ["Loop 1", "Loop 2"] }).axes?.[1]?.label).toBe("R1, R2 (ohm)");
  });

  it("titles mixed units jointly (gap audit 2 #11), and a user title still wins", () => {
    const p = payload([
      { label: "M", unit: "emu" },
      { label: "T", unit: "K" },
    ]);
    expect(buildOpts(p, base).axes?.[1]?.label).toBe("M (emu), T (K)");
    expect(buildOpts(p, { ...base, yAxisLabel: "Signal" }).axes?.[1]?.label).toBe("Signal");
  });

  it("titles the secondary axis by the same rule", () => {
    const p = payload([
      { label: "M", unit: "emu", axis: 0 },
      { label: "T1", unit: "K", axis: 1 },
      { label: "T2", unit: "K", axis: 1 },
    ]);
    expect(buildOpts(p, base).axes?.[2]?.label).toBe("T1, T2 (K)");
  });

  it("counts only the curves drawn: a hidden one never joins the title", () => {
    const p = payload([
      { label: "R1", unit: "ohm" },
      { label: "T", unit: "K" },
      { label: "R2", unit: "ohm" },
    ]);
    expect(buildOpts(p, { ...base, hidden: [false, true, false] }).axes?.[1]?.label).toBe("R1, R2 (ohm)");
  });
});
