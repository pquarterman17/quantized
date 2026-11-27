// Statistical tests' preset adapter: the shared contract plus what is specific
// to it (every test and every option the inputs offer is accepted, nested
// settings are strict, no column list is stored or overwritten).

import { describe, expect, it } from "vitest";

import { describePresetAdapterContract } from "../../../lib/presetAdapterContract.testkit";
import { DEFAULT_PARAMS, STATS_TESTS, type TestParams } from "../../../lib/statsTests";
import type { StatsTestId } from "../../../lib/api/statsTests";
import * as options from "../../../lib/statsTestsOptions";
import { createStatsTestsAdapter, defaultStatsTestsSettings, settingsFrom, type StatsTestsSettings } from "./presetAdapter";

const state: { testId: StatsTestId; params: TestParams } = {
  testId: "anderson",
  params: { ...DEFAULT_PARAMS, screen: { xCols: [3], nominalCols: [4], method: "bh" }, rowt: { ...DEFAULT_PARAMS.rowt, groupB: [1, 2] } },
};
const adapter = createStatsTestsAdapter({
  get testId() { return state.testId; },
  setTestId: (id) => { state.testId = id; },
  get params() { return state.params; },
  setParams: (patch) => { state.params = { ...state.params, ...patch }; },
});

const base = defaultStatsTestsSettings();
const sample: StatsTestsSettings = {
  ...base,
  test: "posthoc", alpha: 0.01, alternative: "greater", ssType: 2, criterion: "bic", direction: "both", effectSize: 0.8, n: 40,
  power: 0.9, kind: "paired", tails: 1, adjustMethod: "bonferroni", gofExpected: "column", survivalGroups: true,
  more: { ...base.more, posthoc: "tukey", variance: "levene", margin: 2, mu0: 1, tostDesign: "paired", coverage: 0.99, confidence: 0.9, tiSides: "upper",
    x1: 3, n1: 10, x2: 4, n2: 12, p0: 0.3, propMethod: "normal", poissonSamples: "two", pc1: 1, pt1: 2, pc2: 3, pt2: 4, rate0: 2, ratio0: 1.5 },
  spc: { ...base.spc, chart: "ewma", subgroupMode: "column", subgroupSize: 4, useSubgroups: true, sigmaMethod: "sd", sizeMode: "constant", sampleSize: 50,
    rules: { ...base.spc.rules, we1: true, nel7: true }, runLength: 9, ewmaLambda: 0.3, ewmaWidth: 2.7, cusumK: 0.6, cusumH: 4, chartTarget: 10, chartSigma: 1, lsl: 1, usl: 9, target: 5 },
  life: { distribution: "lognormal", compare: true, plotting: "kaplan-meier", ciMethod: "likelihood-ratio", quantilesText: "5, 50", timesText: "100", transform: "arrhenius-celsius", useX: 25 },
  screenMethod: "holm",
  rowt: { design: "paired", variance: "pooled", mu: 0.5, adjust: "holm", seasonFrom: "period", period: 4 },
};

describePresetAdapterContract({
  adapter,
  sample,
  wrongType: { field: "alpha", value: "tiny" },
  outOfRange: { field: "alpha", value: 2 },
});

describe("stats tests adapter specifics", () => {
  it("every test in the catalogue is accepted", () => {
    for (const t of STATS_TESTS) expect(adapter.parse({ ...sample, test: t.id }), t.id).not.toHaveProperty("error");
  });

  it("every option the inputs render is accepted, from the shared lists", () => {
    const flat: [keyof StatsTestsSettings, readonly (readonly [unknown, string])[]][] = [
      ["ssType", options.SS_TYPE_OPTIONS], ["criterion", options.CRITERION_OPTIONS], ["direction", options.DIRECTION_OPTIONS],
      ["kind", options.POWER_KIND_OPTIONS], ["tails", options.TAILS_OPTIONS], ["adjustMethod", options.ADJUST_METHOD_OPTIONS],
      ["gofExpected", options.GOF_EXPECTED_OPTIONS],
    ];
    for (const [field, list] of flat) for (const [v] of list) expect(adapter.parse({ ...sample, [field]: v }), `${field}=${String(v)}`).not.toHaveProperty("error");
    for (const alt of options.ALTERNATIVES) expect(adapter.parse({ ...sample, alternative: alt })).not.toHaveProperty("error");
    const nestedLists: [keyof StatsTestsSettings, string, readonly (readonly [unknown, string])[]][] = [
      ["more", "posthoc", options.POSTHOC_OPTIONS], ["more", "variance", options.VARIANCE_OPTIONS], ["more", "tostDesign", options.TOST_DESIGN_OPTIONS],
      ["more", "poissonSamples", options.POISSON_SAMPLES_OPTIONS], ["more", "tiSides", options.TI_SIDES_OPTIONS], ["more", "propMethod", options.PROP_METHOD_OPTIONS],
      ["life", "ciMethod", options.LIFE_CI_OPTIONS], ["life", "plotting", options.LIFE_PLOTTING_OPTIONS],
      ["spc", "subgroupMode", options.SPC_SUBGROUP_MODE_OPTIONS], ["spc", "sigmaMethod", options.SPC_SIGMA_OPTIONS], ["spc", "sizeMode", options.SPC_SIZE_MODE_OPTIONS],
    ];
    for (const [group, field, list] of nestedLists) {
      for (const [v] of list) {
        const raw = { ...sample, [group]: { ...(sample[group] as object), [field]: v } };
        expect(adapter.parse(raw), `${group}.${field}=${String(v)}`).not.toHaveProperty("error");
      }
    }
  });

  it("rejects a bad nested value with the field named, and an unknown nested key", () => {
    expect(adapter.parse({ ...sample, more: { ...sample.more, posthoc: "magic" } })).toMatchObject({ error: expect.stringContaining("'posthoc'") });
    expect(adapter.parse({ ...sample, spc: { ...sample.spc, chart: "pie" } })).toMatchObject({ error: expect.stringContaining("'chart'") });
    expect(adapter.parse({ ...sample, spc: { ...sample.spc, rules: { ...sample.spc.rules, we9: true } } })).toMatchObject({ error: expect.stringContaining("'we9'") });
    expect(adapter.parse({ ...sample, life: { ...sample.life, extra: 1 } })).toMatchObject({ error: expect.stringContaining("'extra'") });
    expect(adapter.parse({ ...sample, rowt: { ...sample.rowt, groupB: [1] } })).toMatchObject({ error: expect.stringContaining("'groupB'") });
    expect(adapter.parse({ ...sample, rowt: { ...sample.rowt, period: 1 } })).toMatchObject({ error: expect.stringContaining("'period'") });
    expect(adapter.parse({ ...sample, test: "t-test-9000" })).toMatchObject({ error: expect.stringContaining("'test'") });
    expect(adapter.parse({ ...sample, n: 0 })).toMatchObject({ error: expect.stringContaining("'n'") });
    expect(adapter.parse({ ...sample, alternative: "sideways" })).toMatchObject({ error: expect.stringContaining("'alternative'") });
  });

  it("stores no column pick, and Apply leaves the panel's column lists alone", () => {
    expect(JSON.stringify(adapter.capture())).not.toContain("xCols");
    expect(JSON.stringify(adapter.capture())).not.toContain("groupB");
    adapter.apply(sample);
    expect(state.params.screen).toEqual({ xCols: [3], nominalCols: [4], method: "holm" });
    expect(state.params.rowt.groupB).toEqual([1, 2]);
    expect(state.params.rowt.design).toBe("paired");
    expect(state.testId).toBe("posthoc");
  });

  it("settingsFrom copies, so a captured preset is not changed by a later edit", () => {
    const s = settingsFrom("anderson", state.params);
    state.params.spc.rules.we1 = !state.params.spc.rules.we1;
    expect(s.spc.rules.we1).not.toBe(state.params.spc.rules.we1);
    state.params.spc.rules.we1 = !state.params.spc.rules.we1;
  });
});
