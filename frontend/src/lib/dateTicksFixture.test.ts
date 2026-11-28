// A calendar X axis puts its ticks at the same round positions on screen and in
// the export (acceptance 10 C4): the screen showed 09:00 and 12:00, the SVG
// 09:03 and 10:26. Pinned as a SHARED wire fixture
// (`tests/fixtures/wire/date_ticks.json`): each case is a real uPlot instance
// drawing a date axis over [lo, hi]; the backend half
// (`tests/test_date_ticks.py`, `calc/date_ticks.py`) must land on the same
// ticks at the same plot width. `clock` records whether the labels carry a
// time of day: a `date` axis over less than a day does (two ticks may never
// share a label), on screen and in the export alike. `label_chars` is the longest label the
// screen drew: the export request carries it (`x_fmt.labelChars`, `lib/liveTickStepsSpec`) so its
// step follows the screen's label width instead of its own estimate of it.
//
// Regenerate only after a DELIBERATE rule change:
//   DATE_TICKS_FIXTURE_WRITE=1 npx vitest run src/lib/dateTicksFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const w = window as unknown as Record<string, unknown>;
  w.matchMedia ??= (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const g = globalThis as unknown as Record<string, unknown>;
  g.Path2D ??= class { moveTo() {} lineTo() {} rect() {} arc() {} closePath() {} bezierCurveTo() {} addPath() {} };
});

import uPlot from "uplot";

import "./uplotPaths";

import { buildColumns } from "./plotdata";
import type { DataStruct, TickMode } from "./types";
import { buildOpts } from "./uplotOpts";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "fixtures", "wire", "date_ticks.json");
const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s) / 1000;

interface Case { name: string; mode: TickMode; lo: number; hi: number }
const CASES: Case[] = [
  { name: "an afternoon, hourly", mode: "datetime", lo: at(2026, 3, 1, 9, 3), hi: at(2026, 3, 1, 17, 26) },
  { name: "a morning in minutes", mode: "datetime", lo: at(2026, 3, 1, 9, 3, 20), hi: at(2026, 3, 1, 10, 26, 40) },
  { name: "ninety seconds", mode: "datetime", lo: at(2026, 3, 1, 9, 0, 7), hi: at(2026, 3, 1, 9, 1, 37) },
  { name: "three days", mode: "datetime", lo: at(2026, 3, 1, 5, 40), hi: at(2026, 3, 4, 11, 10) },
  { name: "a fortnight, date only", mode: "date", lo: at(2026, 3, 2), hi: at(2026, 3, 16) },
  { name: "a year and a half, months", mode: "datetime", lo: at(2025, 2, 11, 6), hi: at(2026, 8, 20, 18) },
  { name: "eight years", mode: "date", lo: at(2018, 5, 3), hi: at(2026, 9, 9) },
  { name: "the date format over less than a day still shows the clock", mode: "date", lo: at(2026, 3, 1, 9, 3), hi: at(2026, 3, 1, 17, 26) },
  { name: "the time format over a fortnight shows the date", mode: "time", lo: at(2026, 3, 2), hi: at(2026, 3, 16) },
];

const live: uPlot[] = [];
afterEach(() => { for (const u of live.splice(0)) u.destroy(); });

async function screen(c: Case) {
  const data: DataStruct = { time: [c.lo, c.hi], values: [[1], [2]], labels: ["y"], units: [""], metadata: { time_is_datetime: true } } as unknown as DataStruct;
  const payload = buildColumns(data);
  const opts = buildOpts(payload, {
    width: 700, height: 400, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn(),
    xFmt: { mode: c.mode, digits: 2 },
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const u = new uPlot(opts, payload.data as uPlot.AlignedData, host);
  live.push(u);
  await new Promise((r) => setTimeout(r, 0));
  u.redraw(); // the tick spacing reads the labels of the previous draw
  u.redraw();
  const axis = u.axes[0] as unknown as { _splits: number[]; _found: [number, number]; _values: (string | null)[] };
  return { ticks: [...axis._splits], labels: axis._values, plot_px: u.bbox.width / uPlot.pxRatio };
}

async function fresh() {
  const cases = [];
  for (const c of CASES) {
    const s = await screen(c);
    cases.push({
      name: c.name, mode: c.mode, lo: c.lo, hi: c.hi, plot_px: Math.round(s.plot_px * 100) / 100, font_px: 12,
      ticks: s.ticks, label_chars: Math.max(...s.labels.map((l) => l?.length ?? 0)), clock: s.labels.some((l) => /\d:\d\d/.test(l ?? "")),
    });
  }
  return { cases };
}

describe("a date axis ticks at the same round positions on screen and in export", () => {
  it("matches the committed fixture the backend half reads", async () => {
    const now = await fresh();
    if (process.env.DATE_TICKS_FIXTURE_WRITE) writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`, "utf8");
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(now)));
  });

  it("puts the first ticks on round times, not on the view's own start", async () => {
    const { cases } = await fresh();
    const afternoon = cases[0]!;
    expect(afternoon.ticks.every((t) => t % 3600 === 0)).toBe(true); // 12:00, 15:00 (never 09:03 + n)
    expect(afternoon.ticks[0]).toBeGreaterThan(afternoon.lo);
    expect(cases[4]!.clock).toBe(false); // the date format over a fortnight: dates only
    expect(cases[7]!.clock).toBe(true); // ...and over an afternoon, the clock, on both sides
  });
});
