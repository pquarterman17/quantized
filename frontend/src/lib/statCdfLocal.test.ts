// Plan item 20: the CDF computed in the browser equals the server's numpy answer
// (`tests/fixtures/wire/stat_cdf_local.json`, kept honest by `tests/test_stat_cdf_local.py`), and the offline
// fallback of `statsCdf` is taken on a network failure only.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { statsCdf } from "./api/statsCdf";
import { cdfWireLocal, dkwEpsilon } from "./statCdfLocal";
import type { CdfWire } from "./statCdf";

interface Case { name: string; columns: (number | null)[][]; y: "proportion" | "count"; band: boolean; expected: CdfWire }
const CASES = (JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "fixtures", "wire", "stat_cdf_local.json"), "utf-8")) as { cases: Case[] }).cases;
const near = (a: readonly number[], b: readonly number[]) => {
  expect(a).toHaveLength(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 12));
};
const cols = (c: Case) => c.columns.map((col) => col.map((v) => v ?? Number.NaN));

afterEach(() => vi.unstubAllGlobals());

describe("the CDF computed in the browser", () => {
  it.each(CASES)("$name matches numpy", (c) => {
    const got = cdfWireLocal(cols(c), c.y, c.band);
    expect(got.y).toBe(c.expected.y);
    near(got.domain, c.expected.domain);
    expect(got.y_max).toBe(c.expected.y_max);
    expect(got.series).toHaveLength(c.expected.series.length);
    got.series.forEach((s, k) => {
      const want = c.expected.series[k];
      expect(s.n).toBe(want.n);
      near(s.x, want.x);
      near(s.y, want.y);
      expect(Boolean(s.band)).toBe(Boolean(want.band));
      if (s.band && want.band) {
        expect(s.band.eps).toBeCloseTo(want.band.eps, 14);
        near(s.band.lo, want.band.lo);
        near(s.band.hi, want.band.hi);
        expect(s.band.lo0).toBe(want.band.lo0);
        expect(s.band.hi0).toBeCloseTo(want.band.hi0, 14);
      }
    });
  });

  it("refuses what the server refuses", () => {
    expect(() => cdfWireLocal([[Number.NaN]])).toThrow(/at least one finite value/);
    expect(() => cdfWireLocal([])).toThrow(/1 to 64 columns/);
  });

  it("the DKW half-width of 6 values", () => {
    expect(dkwEpsilon(6)).toBeCloseTo(0.5544426220774891, 14); // the server's, in the stat_cdf_rug fixture
  });
});

describe("statsCdf offline", () => {
  const cdf = (fit?: string) => statsCdf([[3, 1, 2]], "proportion", true, fit);

  it("falls back to the local numbers when the server cannot be reached, and says so", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const r = await cdf();
    expect(r.local).toBe(true);
    near(r.series[0].x, [1, 2, 3]);
    near(r.series[0].y, [1 / 3, 2 / 3, 1]);
  });

  it("refuses a fitted CDF offline, with the reason", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(cdf("norm")).rejects.toThrow(/needs the server/);
  });

  it("does not hide a server refusal behind the local numbers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "unknown distribution 'zzz'" }), { status: 422, headers: { "Content-Type": "application/json" } })));
    await expect(cdf("zzz")).rejects.toThrow(/unknown distribution/);
  });
});

describe("the Stat Stage's CDF draw with no server", () => {
  it("draws the local steps, marks them as local, and refuses a fit", async () => {
    const { computeSampleDraw } = await import("../components/Stage/statSampleDraw");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const data = { time: [0, 1, 2, 3], values: [[2], [1], [Number.NaN], [2]], labels: ["V"], units: [""], metadata: {} };
    const opts = { valueCol: 0, histCols: [], dist: "norm", bins: "auto", fit: null, valueLabel: "V", cdfY: "count" as const, cdfBand: false };
    const draw = await computeSampleDraw("cdf", data, opts as never);
    expect(draw.mode).toBe("cdf");
    const wire = (draw as { wire: CdfWire }).wire;
    near(wire.series[0].x, [1, 2]);
    near(wire.series[0].y, [1, 3]); // counts at or below: one value <= 1, three <= 2
    expect((draw as { wire: CdfWire }).wire.local).toBe(true); // the stage turns this into its note ("computed locally")
    await expect(computeSampleDraw("cdf", data, { ...opts, fit: "norm" } as never)).rejects.toThrow(/needs the server/);
  });
});
