// A date-only timestamp X (every finite value midnight UTC) draws and shows as
// dates: no "00:00" in ticks or worksheet cells (acceptance 6 C5). Shares
// tests/fixtures/wire/date_only_x.json with tests/test_date_only_x.py, which
// asserts the export's side of the same rule.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type uPlot from "uplot";
import { describe, expect, it, vi } from "vitest";

import { dateAwareXFmt } from "./axisFormat";
import { isDateOnly } from "./dateOnly";
import { buildColumns } from "./plotdata";
import type { DataStruct } from "./types";
import { buildOpts } from "./uplotOpts";
import { gridFormatters } from "../components/Stage/worksheet/cellFormat";

interface Case { name: string; time: (number | null)[]; date_only: boolean; cell: string }
const { cases } = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "tests", "fixtures", "wire", "date_only_x.json"), "utf8")) as { cases: Case[] };

const dsOf = (time: (number | null)[]): DataStruct =>
  ({ time, values: time.map(() => [1]), labels: ["y"], units: [""], metadata: { time_is_datetime: true } }) as unknown as DataStruct;

describe.each(cases)("$name", (c) => {
  it("is date-only exactly when the shared rule says", () => {
    expect(isDateOnly(c.time)).toBe(c.date_only);
    expect(buildColumns(dsOf(c.time)).xIsDate).toBe(c.date_only ? "date" : true);
  });

  it("shows the first worksheet cell as the fixture says", () => {
    const ds = dsOf(c.time);
    expect(gridFormatters(ds.time, ds.values, undefined, true)(-1)(c.time[0] ?? undefined)).toBe(c.cell);
  });

  it("draws daily ticks without a clock only for a date-only X", () => {
    const payload = buildColumns(dsOf(c.time));
    const opts = buildOpts(payload, {
      width: 600, height: 400, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn(),
      xFmt: { mode: "auto", digits: 2 },
    });
    const values = opts.axes?.[0]?.values as (u: uPlot, s: number[], a: number, f: number, i: number) => (string | null)[];
    const first = c.time.find((t) => t != null);
    if (first == null) return;
    const [label] = values({} as uPlot, [first], 0, 0, 86400);
    expect(/00:00/.test(label ?? "")).toBe(!c.date_only);
  });
});

it("maps a date-only X to the date mode and keeps the other rules", () => {
  expect(dateAwareXFmt({ mode: "auto", digits: 2 }, "date")).toEqual({ mode: "date", digits: 2 });
  expect(dateAwareXFmt({ mode: "fixed", digits: 1 }, "date")).toEqual({ mode: "fixed", digits: 1 });
  expect(dateAwareXFmt({ mode: "auto", digits: 2 }, true)).toEqual({ mode: "datetime", digits: 2 });
});
