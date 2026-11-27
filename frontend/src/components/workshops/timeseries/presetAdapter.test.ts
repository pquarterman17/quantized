// Time series' preset adapter: the shared contract plus what is specific to it
// (the series by label, nested strictness, the cross-field rule, every offered
// option accepted, nothing that names data).

import { describe, expect, it } from "vitest";

import { genericBackend } from "../../../lib/presets";
import { describePresetAdapterContract } from "../../../lib/presetAdapterContract.testkit";
import { createTimeSeriesAdapter, type TimeSeriesSettings } from "./presetAdapter";
import {
  ARIMA_TREND_OPTIONS, CP_COST_OPTIONS, CP_METHOD_OPTIONS, CP_PENALTY_OPTIONS, DECOMP_MODEL_OPTIONS, STAT_REGRESSION_OPTIONS, STAT_TESTS_OPTIONS,
} from "./timeSeriesOptions";
import { TS_TABS, tsDefaultOptions, type TsOptions, type TsTab } from "./timeSeriesRun";

const handle = {
  columns: [{ index: 0, label: "pressure" }, { index: 1, label: "temperature" }, { index: 2, label: "dup" }, { index: 3, label: "dup" }],
  col: 0,
  tab: "correlogram" as TsTab,
  opts: tsDefaultOptions() as TsOptions,
  setCol(i: number) { handle.col = i; },
  setTab(t: TsTab) { handle.tab = t; },
  patch(section: keyof TsOptions, value: unknown) {
    handle.opts = { ...handle.opts, [section]: typeof handle.opts[section] === "object" ? { ...(handle.opts[section] as object), ...(value as object) } : value };
  },
};
const adapter = createTimeSeriesAdapter(handle as never);

const sample: TimeSeriesSettings = {
  tab: "arima", series: "temperature", allowIrregular: true,
  corr: { nlags: 12, alpha: 0.1 },
  stat: { tests: "kpss", regression: "ct", alpha: 0.01 },
  decomp: { period: 24, model: "multiplicative" },
  cp: { method: "binseg", cost: "meanvar", penalty: "value", penaltyValue: 7, minSize: 5, maxChanges: 3 },
  arima: { p: 2, d: 1, q: 1, trend: "n", steps: 15, alpha: 0.1 },
};

describePresetAdapterContract({
  adapter,
  sample,
  wrongType: { field: "corr", value: "none" },
  outOfRange: { field: "arima", value: { ...sample.arima, p: 9 } },
  missingColumn: { settings: { ...sample, series: "ghost" }, field: "series", labels: ["pressure"], required: false },
});

const TAB_OF = { corr: "correlogram", stat: "stationarity", decomp: "decompose", cp: "changepoint", arima: "arima" } as const;
/** Parse `sample` with one option group edited, on the tool that SHOWS that group (a hidden group is only type checked). */
const bad = (section: keyof typeof TAB_OF, patch: Record<string, unknown>) =>
  adapter.parse({ ...sample, tab: TAB_OF[section], [section]: { ...sample[section], ...patch } });

describe("time series adapter specifics", () => {
  it("every option the forms offer is accepted", () => {
    for (const o of STAT_TESTS_OPTIONS) expect(bad("stat", { tests: o.value }), o.value).not.toHaveProperty("error");
    for (const o of STAT_REGRESSION_OPTIONS) expect(bad("stat", { regression: o.value }), o.value).not.toHaveProperty("error");
    for (const o of DECOMP_MODEL_OPTIONS) expect(bad("decomp", { model: o.value }), o.value).not.toHaveProperty("error");
    for (const o of CP_METHOD_OPTIONS) expect(bad("cp", { method: o.value, maxChanges: 0 }), o.value).not.toHaveProperty("error");
    for (const o of CP_COST_OPTIONS) expect(bad("cp", { cost: o.value }), o.value).not.toHaveProperty("error");
    for (const o of CP_PENALTY_OPTIONS) expect(bad("cp", { penalty: o.value }), o.value).not.toHaveProperty("error");
    for (const o of ARIMA_TREND_OPTIONS) expect(bad("arima", { trend: o.value }), o.value).not.toHaveProperty("error");
    for (const t of TS_TABS) expect(adapter.parse({ ...sample, tab: t.id }), t.id).not.toHaveProperty("error");
  });

  it("rejects each bad value with its field named, nested keys included", () => {
    expect(adapter.parse({ ...sample, tab: "spectrum" })).toMatchObject({ error: expect.stringContaining("'tab'") });
    expect(bad("corr", { alpha: 1 })).toMatchObject({ error: expect.stringContaining("'alpha'") });
    expect(bad("corr", { nlags: -1 })).toMatchObject({ error: expect.stringContaining("'nlags'") });
    expect(bad("decomp", { period: 1 })).toMatchObject({ error: expect.stringContaining("'period'") });
    expect(bad("decomp", { model: "log" })).toMatchObject({ error: expect.stringContaining("'model'") });
    expect(bad("cp", { minSize: 1 })).toMatchObject({ error: expect.stringContaining("'minSize'") });
    expect(bad("arima", { d: 3 })).toMatchObject({ error: expect.stringContaining("'d'") });
    expect(bad("arima", { extra: 1 })).toMatchObject({ error: expect.stringContaining("'extra'") });
    expect(adapter.parse({ ...sample, series: "" })).toMatchObject({ error: expect.stringContaining("'series'") });
  });

  it("options the chosen tool hides are neither refused nor stored", () => {
    // another tool's group: only its kind of value is checked
    expect(adapter.parse({ ...sample, tab: "arima", corr: { nlags: -4, alpha: 7 }, stat: { tests: "zzz", regression: "q", alpha: 9 } })).not.toHaveProperty("error");
    expect(adapter.parse({ ...sample, tab: "arima", corr: { nlags: "x", alpha: 0.1 } })).toMatchObject({ error: expect.stringContaining("'nlags'") });
    expect(adapter.parse({ ...sample, tab: "arima", corr: { nlags: 1, alpha: 0.1, extra: 1 } })).toMatchObject({ error: expect.stringContaining("'extra'") });
    // PELT hides the cap, and the penalty value is hidden unless the penalty is "value"
    expect(bad("cp", { method: "pelt", maxChanges: 3 })).not.toHaveProperty("error");
    expect(bad("cp", { penalty: "bic", penaltyValue: -5 })).not.toHaveProperty("error");
    expect(bad("cp", { method: "binseg", maxChanges: -1 })).toMatchObject({ error: expect.stringContaining("'maxChanges'") });
    expect(bad("cp", { penalty: "value", penaltyValue: -5 })).toMatchObject({ error: expect.stringContaining("'penaltyValue'") });
    // a save stores defaults for the refused hidden values, and Save is not blocked
    handle.tab = "arima";
    handle.opts = { ...tsDefaultOptions(), corr: { nlags: -4, alpha: 7 }, stat: { tests: "kpss", regression: "ct", alpha: 0.01 } };
    const captured = adapter.capture();
    expect(captured.corr).toEqual(tsDefaultOptions().corr);
    expect(captured.stat).toEqual({ tests: "kpss", regression: "ct", alpha: 0.01 }); // a valid hidden value is kept
    localStorage.clear();
    expect(genericBackend(adapter).save("hidden", captured)).toMatchObject({ ok: true });
    localStorage.clear();
    handle.tab = "changepoint";
    handle.opts = { ...tsDefaultOptions(), cp: { ...tsDefaultOptions().cp, method: "pelt", penalty: "bic", penaltyValue: -3, maxChanges: 4 } };
    expect(adapter.capture().cp).toMatchObject({ penaltyValue: 10, maxChanges: 0 });
    expect(adapter.parse(adapter.capture())).not.toHaveProperty("error");
  });

  it("an Apply does not write a refused hidden value into the panel (PELT keeps the cap at 0)", () => {
    handle.tab = "correlogram";
    handle.opts = tsDefaultOptions();
    adapter.apply({ ...sample, tab: "changepoint", cp: { ...sample.cp, method: "pelt", maxChanges: 3 }, corr: { nlags: -9, alpha: 5 } });
    expect(handle.opts.cp).toMatchObject({ method: "pelt", maxChanges: 0 });
    expect(handle.opts.corr).toEqual(tsDefaultOptions().corr);
  });

  it("a missing series is skipped and named, the rest applies, and the series stays", () => {
    handle.col = 0;
    const out = adapter.apply({ ...sample, series: "ghost" });
    expect(out).toMatchObject({ ok: true, skipped: [{ field: "series", reason: "column 'ghost' is not on this sheet" }] });
    expect(handle.col).toBe(0);
    expect(handle.tab).toBe("arima");
    expect(handle.opts.arima.p).toBe(2);
  });

  it("a series label that appears twice is skipped, not guessed", () => {
    handle.col = 1;
    const out = adapter.apply({ ...sample, series: "dup" });
    expect(out).toMatchObject({ ok: true, skipped: [{ field: "series", reason: expect.stringContaining("appears more than once") }] });
    expect(handle.col).toBe(1);
  });

  it("stores the series by label, never an index or dataset", () => {
    handle.col = 1;
    expect(adapter.capture().series).toBe("temperature");
    expect(Object.keys(adapter.capture()).sort()).toEqual(["allowIrregular", "arima", "corr", "cp", "decomp", "series", "stat", "tab"]);
  });
});
