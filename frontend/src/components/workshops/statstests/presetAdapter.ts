// Statistical tests' preset adapter (plans/PRESET_BAR_CONTRACT.md section 6),
// generic backend. A preset is the test and its options: the alternative, the
// sums-of-squares type, the post hoc / variance / interval methods, the SPC and
// life-data settings and so on, and alpha. Settings only (P5): no column picks,
// so the column lists inside the options (response screening's factors, the
// row-wise group B) are left as they are on the panel, and nothing names a
// dataset or a row. Every choice from a list is checked against the lists the
// inputs render their selects from (lib/statsTestsOptions and the workshop's own
// catalogs), so there is no second copy.
// Lazy: loaded with the preset bar and after a successful run.

import type { StatsTestId } from "../../../lib/api/statsTests";
import {
  checkBoolean, checkOneOf, parseFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { defaultAlpha } from "../../../lib/locale";
import { ROWT_ADJUSTMENTS } from "../../../lib/rowTestWorksheet";
import { DEFAULT_PARAMS, STATS_TESTS, testDef, testUsesAlpha, type TestParams } from "../../../lib/statsTests";
import { LIFE_DISTS, LIFE_TRANSFORMS, type LifeParams } from "../../../lib/statsTestsLife";
import { type MoreParams } from "../../../lib/statsTestsMore";
import {
  ADJUST_METHOD_OPTIONS, ALTERNATIVES, CRITERION_OPTIONS, DIRECTION_OPTIONS, GOF_EXPECTED_OPTIONS, LIFE_CI_OPTIONS,
  LIFE_PLOTTING_OPTIONS, POISSON_SAMPLES_OPTIONS, POSTHOC_OPTIONS, POWER_KIND_OPTIONS, PROP_METHOD_OPTIONS, SPC_SIGMA_OPTIONS,
  SPC_SIZE_MODE_OPTIONS, SPC_SUBGROUP_MODE_OPTIONS, SS_TYPE_OPTIONS, TAILS_OPTIONS, TI_SIDES_OPTIONS, TOST_DESIGN_OPTIONS,
  VARIANCE_OPTIONS, optionValues,
} from "../../../lib/statsTestsOptions";
import { ROWT_DESIGNS, ROWT_VARIANCES, type RowTParams } from "../../../lib/statsTestsRows";
import { MAX_PERIOD, SEASON_FROM } from "../../../lib/statsTestsSeasonal";
import { SCREEN_METHODS, type ScreenMethod } from "../../../lib/statsTestsScreen";
import { SPC_CHARTS, SPC_NELSON_RULES, SPC_RULES, type SpcParams, type SpcRuleId } from "../../../lib/statsTestsSpc";
import type { StatsTestsState } from "./useStatsTests";

/** `rowt` without its group B column list (columns are not stored). */
export type RowTSettings = Omit<RowTParams, "groupB">;

export interface StatsTestsSettings {
  test: StatsTestId;
  alpha: number;
  alternative: TestParams["alternative"];
  ssType: TestParams["ssType"];
  criterion: TestParams["criterion"];
  direction: TestParams["direction"];
  effectSize: number;
  n: number | null;
  power: number;
  kind: TestParams["kind"];
  tails: TestParams["tails"];
  adjustMethod: TestParams["adjustMethod"];
  gofExpected: TestParams["gofExpected"];
  survivalGroups: boolean;
  more: MoreParams;
  spc: SpcParams;
  life: LifeParams;
  /** Response screening's adjustment (its factor columns are not stored). */
  screenMethod: ScreenMethod;
  rowt: RowTSettings;
}

/** The slice of the panel the adapter reads and writes. */
export type StatsTestsPanelHandle = Pick<StatsTestsState, "testId" | "setTestId" | "params" | "setParams">;

export const STATS_TESTS_WORKSHOP = "stats-tests";
export const STATS_TESTS_SCHEMA = 1;

const ids = (list: readonly { id: string }[]): string[] => list.map((x) => x.id);
const oneOfValues = <T extends string | number>(pairs: readonly (readonly [T, string])[]): FieldCheck => {
  const allowed: (string | number)[] = optionValues(pairs);
  return (v) => (allowed.includes(v as string | number) ? null : `must be one of ${allowed.join(", ")}`);
};
const finite: FieldCheck = (v) => (typeof v === "number" && Number.isFinite(v) ? null : "must be a number");
const finiteOrNull: FieldCheck = (v) => (v === null || finite(v) === null ? null : "must be a number or null (not set)");
const shortText: FieldCheck = (v) => (typeof v === "string" && v.length <= 200 ? null : "must be text of at most 200 characters");
const alpha: FieldCheck = (v) => finite(v) ?? ((v as number) > 0 && (v as number) < 1 ? null : "must be between 0 and 1");
const wholeOrNull: FieldCheck = (v) =>
  v === null || (typeof v === "number" && Number.isInteger(v) && v >= 1) ? null : "must be a whole number of 1 or more, or null (solve)";

/** A nested settings object: every key of `spec` present, any other rejected, each checked. */
const nested = <S extends object>(spec: { [K in keyof S & string]: FieldCheck }): FieldCheck => (v) => {
  const r = parseFields<S>(v, spec);
  return "error" in r && Object.keys(r).length === 1 ? `is not valid: ${r.error}` : null;
};

const RULE_IDS: SpcRuleId[] = [...SPC_RULES, ...SPC_NELSON_RULES].map((r) => r.id);
const rulesCheck: FieldCheck = nested<Record<SpcRuleId, boolean>>(
  Object.fromEntries(RULE_IDS.map((id) => [id, checkBoolean])) as Record<SpcRuleId, FieldCheck>,
);

function parseSettings(raw: unknown): StatsTestsSettings | { error: string } {
  return parseFields<StatsTestsSettings>(raw, {
    test: checkOneOf(ids(STATS_TESTS)),
    alpha,
    alternative: checkOneOf(ALTERNATIVES),
    ssType: oneOfValues(SS_TYPE_OPTIONS),
    criterion: oneOfValues(CRITERION_OPTIONS),
    direction: oneOfValues(DIRECTION_OPTIONS),
    effectSize: finite,
    n: wholeOrNull,
    power: finite,
    kind: oneOfValues(POWER_KIND_OPTIONS),
    tails: oneOfValues(TAILS_OPTIONS),
    adjustMethod: oneOfValues(ADJUST_METHOD_OPTIONS),
    gofExpected: oneOfValues(GOF_EXPECTED_OPTIONS),
    survivalGroups: checkBoolean,
    more: nested<MoreParams>({
      posthoc: oneOfValues(POSTHOC_OPTIONS), variance: oneOfValues(VARIANCE_OPTIONS), margin: finiteOrNull, mu0: finite,
      tostDesign: oneOfValues(TOST_DESIGN_OPTIONS), coverage: finite, confidence: finite, tiSides: oneOfValues(TI_SIDES_OPTIONS),
      x1: finiteOrNull, n1: finiteOrNull, x2: finiteOrNull, n2: finiteOrNull, p0: finite, propMethod: oneOfValues(PROP_METHOD_OPTIONS),
      poissonSamples: oneOfValues(POISSON_SAMPLES_OPTIONS), pc1: finiteOrNull, pt1: finiteOrNull, pc2: finiteOrNull, pt2: finiteOrNull,
      rate0: finite, ratio0: finite,
    }),
    spc: nested<SpcParams>({
      chart: checkOneOf(ids(SPC_CHARTS)), subgroupMode: oneOfValues(SPC_SUBGROUP_MODE_OPTIONS), subgroupSize: finite,
      useSubgroups: checkBoolean, sigmaMethod: oneOfValues(SPC_SIGMA_OPTIONS), sizeMode: oneOfValues(SPC_SIZE_MODE_OPTIONS),
      sampleSize: finite, rules: rulesCheck, runLength: finite, ewmaLambda: finite, ewmaWidth: finite, cusumK: finite, cusumH: finite,
      chartTarget: finiteOrNull, chartSigma: finiteOrNull, lsl: finiteOrNull, usl: finiteOrNull, target: finiteOrNull,
    }),
    life: nested<LifeParams>({
      distribution: checkOneOf(ids(LIFE_DISTS)), compare: checkBoolean, plotting: oneOfValues(LIFE_PLOTTING_OPTIONS),
      ciMethod: oneOfValues(LIFE_CI_OPTIONS), quantilesText: shortText, timesText: shortText,
      transform: checkOneOf(ids(LIFE_TRANSFORMS)), useX: finiteOrNull,
    }),
    screenMethod: checkOneOf(ids(SCREEN_METHODS)),
    rowt: nested<RowTSettings>({
      design: checkOneOf(ids(ROWT_DESIGNS)), variance: checkOneOf(ids(ROWT_VARIANCES)), mu: finite,
      adjust: checkOneOf(ids(ROWT_ADJUSTMENTS)), seasonFrom: checkOneOf(ids(SEASON_FROM)),
      period: (v) => (typeof v === "number" && Number.isInteger(v) && v >= 2 && v <= MAX_PERIOD ? null : `must be a whole number from 2 to ${MAX_PERIOD}`),
    }),
  });
}

export function settingsFrom(test: StatsTestId, p: TestParams): StatsTestsSettings {
  const { groupB: _groupB, ...rowt } = p.rowt;
  void _groupB;
  return {
    test, alpha: p.alpha, alternative: p.alternative, ssType: p.ssType, criterion: p.criterion, direction: p.direction,
    effectSize: p.effectSize, n: p.n, power: p.power, kind: p.kind, tails: p.tails, adjustMethod: p.adjustMethod,
    gofExpected: p.gofExpected, survivalGroups: p.survivalGroups,
    more: { ...p.more }, spc: { ...p.spc, rules: { ...p.spc.rules } }, life: { ...p.life },
    screenMethod: p.screen.method, rowt,
  };
}

export const defaultStatsTestsSettings = (): StatsTestsSettings =>
  settingsFrom("anderson", { ...DEFAULT_PARAMS, alpha: defaultAlpha() });

export function createStatsTestsAdapter(panel: StatsTestsPanelHandle): PresetAdapter<StatsTestsSettings> {
  return {
    workshop: STATS_TESTS_WORKSHOP,
    label: "Statistical tests",
    runLabel: "Run test",
    schema: STATS_TESTS_SCHEMA,
    defaults: defaultStatsTestsSettings,
    parse: parseSettings,
    capture: () => settingsFrom(panel.testId, panel.params),
    apply(settings): ApplyOutcome {
      const { test, screenMethod, rowt, ...options } = settings;
      const cur = panel.params;
      if (test !== panel.testId) panel.setTestId(test);
      panel.setParams({
        ...options,
        more: { ...options.more }, spc: { ...options.spc, rules: { ...options.spc.rules } }, life: { ...options.life },
        screen: { ...cur.screen, method: screenMethod },
        rowt: { ...cur.rowt, ...rowt },
      });
      return { ok: true, applied: Object.keys(settings), skipped: [], notes: ["column picks are not stored in a preset: check them for this test"] };
    },
    describe: (s) => `${testDef(s.test).label}${testUsesAlpha(s.test) ? `, alpha ${s.alpha}` : ""}`,
  };
}

/** After a successful run: remember the test and its options as last used (only if they would read back). */
export function recordStatsTestsRun(test: StatsTestId, params: TestParams): void {
  const settings = settingsFrom(test, params);
  if ("error" in parseSettings(settings)) return;
  recordLastUsed({ workshop: STATS_TESTS_WORKSHOP, schema: STATS_TESTS_SCHEMA }, settings);
}
