// The seasonal Mann-Kendall request builder and the restore of its settings.

import { describe, expect, it } from "vitest";

import { DEFAULT_PARAMS, DEFAULT_SELECTION, type TestParams } from "./statsTests";
import { restoreRowT } from "./statsTestsRows";
import { buildSeasonal, restoreSeasonal, seasonalColumns } from "./statsTestsSeasonal";
import type { DataStruct } from "./types";

const data: DataStruct = {
  time: [0, 1, 2, 3, 4, 5], values: [[5, 1], [6, 2], [7, 1], [Number.NaN, 2], [9, 1], [8, 2]],
  labels: ["y", "m"], units: ["", ""], metadata: { x_column_name: "t" },
};
const sel = { ...DEFAULT_SELECTION, x: -1, y: 0, byCol: 1 };
const params = (patch: Partial<TestParams["rowt"]>): TestParams => ({ ...DEFAULT_PARAMS, rowt: { ...DEFAULT_PARAMS.rowt, ...patch } });

describe("buildSeasonal", () => {
  it("sends finite rows with the season column", () => {
    const out = buildSeasonal(data, sel, params({}));
    expect(out).toMatchObject({ ok: true, request: { id: "seasonal-mann-kendall", body: { x: [0, 1, 2, 4, 5], y: [5, 6, 7, 9, 8], season: [1, 2, 1, 1, 2], alpha: 0.05 } } });
  });

  it("sends a period instead of a season column", () => {
    const out = buildSeasonal(data, sel, params({ seasonFrom: "period", period: 2 }));
    expect(out).toMatchObject({ ok: true, request: { body: { period: 2 } } });
    expect(out.ok && "season" in (out.request.body as object)).toBe(false);
  });

  it("refuses with the reason", () => {
    const err = (s: typeof sel, p: TestParams) => { const o = buildSeasonal(data, s, p); return o.ok ? null : o.error; };
    expect(err({ ...sel, y: -1 }, params({}))).toMatch(/two different columns/);
    expect(err({ ...sel, byCol: 0 }, params({}))).toMatch(/season column must differ/);
    expect(err(sel, params({ seasonFrom: "period", period: 1 }))).toMatch(/whole number from 2 to 1000/);
    expect(err(sel, params({ seasonFrom: "period", period: 2.5 }))).toMatch(/whole number/);
    expect(err({ ...sel, byCol: 1 }, params({})) === null).toBe(true);
    expect(buildSeasonal({ ...data, time: [0, 1], values: [[1, 1], [2, 2]] }, sel, params({}))).toMatchObject({ ok: false });
  });

  it("reads the columns it uses, in order", () => {
    expect(seasonalColumns(sel, "column")).toEqual([-1, 0, 1]);
    expect(seasonalColumns(sel, "period")).toEqual([-1, 0]);
  });
});

describe("restore", () => {
  it("defaults when absent, exact when present, null when invalid", () => {
    expect(restoreSeasonal({})).toEqual({ seasonFrom: "column", period: 12 });
    expect(restoreSeasonal({ seasonFrom: "period", period: 4 })).toEqual({ seasonFrom: "period", period: 4 });
    for (const bad of [{ seasonFrom: "x" }, { period: 1 }, { period: 1001 }, { period: 2.5 }, { period: "4" }]) expect(restoreSeasonal(bad)).toBeNull();
  });

  it("a saved rowt record from before the seasonal test restores with the defaults", () => {
    const old = { groupB: [2], design: "paired", variance: "welch", mu: 0, adjust: "holm" };
    expect(restoreRowT(old)).toMatchObject({ ...old, seasonFrom: "column", period: 12 });
  });
});
