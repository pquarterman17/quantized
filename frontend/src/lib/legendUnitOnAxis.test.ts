// UX8-C: the display-only legend flag of a shared-unit graph. The cases in
// `tests/fixtures/wire/legend_unit_on_axis.json` are shared with the export
// leg (`tests/test_export_legend_unit_on_axis.py`).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { legendUnitOnAxis } from "./legendUnitOnAxis";
import type { PlotPayload } from "./plotdata";
import { seriesDisplayLabel } from "./seriesDisplayLabel";
import type { DataStruct } from "./types";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "legend_unit_on_axis.json",
);
interface Case {
  name: string;
  flag: boolean;
  series: [string, string, string | null][];
  legend: string[];
}
const CASES = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: Case[] }).cases;

const payload: PlotPayload = {
  data: [[0, 1], [1, 2], [3, 4], [5, 6]] as unknown as PlotPayload["data"],
  series: [
    { label: "MH_010K", unit: "emu" },
    { label: "MH_040K", unit: "emu", legend: "renamed upstream" },
    { label: "MH_010K (excluded)", unit: "emu", muted: true },
  ],
  xLabel: "Field",
  xUnit: "Oe",
};
const data = (meta: Record<string, unknown>): DataStruct => ({ time: [0], values: [[1]], labels: ["a"], units: ["emu"], metadata: meta });

describe("legendUnitOnAxis", () => {
  it("names each data curve by its bare label, keeping its unit and every companion untouched", () => {
    const out = legendUnitOnAxis(payload, data({ legend_unit_on_axis: true }));
    expect(out.series.map((s) => s.legend)).toEqual(["MH_010K", "renamed upstream", undefined]);
    expect(out.series.map((s) => s.unit)).toEqual(["emu", "emu", "emu"]);
  });

  // The shared wire fixture. The screen leg resolves each row exactly as
  // PlotLegend's `rowText` does: `labels?.[i] ?? seriesLabels[plotted[i]] ??
  // defaultLabel(s)`, with `defaultLabel = s.legend ?? withUnit(label, unit)`
  // (`seriesDisplayLabel`). A rename lives in `seriesLabels`, keyed by channel.
  it.each(CASES.map((c) => [c.name, c] as const))("shared fixture: %s", (_name, c) => {
    const p: PlotPayload = { ...payload, series: c.series.map(([label, unit]) => ({ label, unit })) };
    const out = legendUnitOnAxis(p, data(c.flag ? { legend_unit_on_axis: true } : {}));
    const plotted = c.series.map((_, i) => i);
    const seriesLabels: Record<number, string> = Object.fromEntries(
      c.series.flatMap(([, , rename], ch) => (rename === null ? [] : [[ch, rename]])),
    );
    const labels: (string | undefined)[] | undefined = undefined;
    const defaultLabel = (s: PlotPayload["series"][number]) => seriesDisplayLabel(s.label, s.unit, s.legend);
    const rowText = (s: PlotPayload["series"][number], i: number) =>
      i < plotted.length ? ((labels as (string | undefined)[] | undefined)?.[i] ?? seriesLabels[plotted[i]] ?? defaultLabel(s)) : defaultLabel(s);
    expect(out.series.map(rowText)).toEqual(c.legend);
  });

  // Review: a duplicated graph keeps the metadata but not its linked curves,
  // so a later "dM/dH (emu/Oe)" column must NOT lose its unit.
  it("ignores a stale flag: curves no longer sharing one unit keep label (unit)", () => {
    const mixed: PlotPayload = {
      ...payload,
      series: [{ label: "MH_010K", unit: "emu" }, { label: "dM/dH", unit: "emu/Oe" }, { label: "fit", unit: "", overlay: true }],
    };
    expect(legendUnitOnAxis(mixed, data({ legend_unit_on_axis: true }))).toBe(mixed);
  });

  it("is the identity without the flag", () => {
    expect(legendUnitOnAxis(payload, data({}))).toBe(payload);
    expect(legendUnitOnAxis(payload, undefined)).toBe(payload);
  });
});
