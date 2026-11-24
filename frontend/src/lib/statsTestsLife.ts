// Statistical-tests workshop — censored life distributions and Fit Life by X
// (GAP_AUDIT_9 G8): catalog entries, settings and the pure request builder.
// Delegated to by statsTests.ts so that file stays small.
//
// The censor column follows JMP: 1 = censored (still running), 0 = failed. Rows
// keep worksheet order and drop any row where a needed column is not finite.
// Time must be non-negative (and > 0 for the ln-time families; the backend says
// so), the censor column must be 0/1, and the backend refuses fewer than 2
// failures — nothing is repaired silently.
//
// Provisional, owner to confirm: Weibull is the default distribution; the
// confidence level is the workshop's alpha (95%); intervals are Wald; the
// default B-lives are B1, B10 and B50; median-rank plotting positions.

import type { StatsTestRequest } from "./api/statsTests";
import type { LifeDist, LifeTransform } from "./api/statsTestsLife";
import { columnDisplayName } from "./statschooser";
import type { DataStruct } from "./types";
import type { BuildOutcome, TestDef, TestParams, TestSelection } from "./statsTests";

export type LifePlotting = "median-rank" | "kaplan-meier";

export type LifeParams = {
  distribution: LifeDist;
  /** Also fit the other families and rank them by AICc / BIC. */
  compare: boolean;
  plotting: LifePlotting;
  /** B-life percentages, comma separated (10 = B10). */
  quantilesText: string;
  /** Times at which to report the failure probability, comma separated. */
  timesText: string;
  /** Fit Life by X: the life-stress relationship, and the use condition. */
  transform: LifeTransform;
  useX: number | null;
};

export const DEFAULT_LIFE: LifeParams = {
  distribution: "weibull", compare: false, plotting: "median-rank",
  quantilesText: "1, 10, 50", timesText: "", transform: "arrhenius-celsius", useX: null,
};

export const LIFE_DISTS: readonly { id: LifeDist; label: string }[] = [
  { id: "weibull", label: "Weibull" },
  { id: "lognormal", label: "Lognormal" },
  { id: "exponential", label: "Exponential" },
  { id: "loglogistic", label: "Loglogistic" },
  { id: "sev", label: "Smallest extreme value" },
];

export const LIFE_TRANSFORMS: readonly { id: LifeTransform; label: string; unit: string }[] = [
  { id: "arrhenius-celsius", label: "Arrhenius (temperature in °C)", unit: "°C" },
  { id: "arrhenius-kelvin", label: "Arrhenius (temperature in K)", unit: "K" },
  { id: "power", label: "Inverse power law (ln x)", unit: "" },
  { id: "linear", label: "Linear in x", unit: "" },
];

export const LIFE_TESTS: readonly TestDef[] = [
  { id: "life-distribution", family: "Reliability (life data)", label: "Life distribution (censored Weibull · lognormal · probability plot)", input: "life", blurb: "How long do units last? Fit censored life data, plot it on probability paper and read B10 life." },
  { id: "life-by-x", family: "Reliability (life data)", label: "Fit Life by X (Arrhenius · power law)", input: "life", blurb: "How does life shorten with temperature or another stress, and what life is expected at use conditions?" },
];

export const LIFE_IDS: ReadonlySet<string> = new Set(LIFE_TESTS.map((t) => t.id));

const col = (data: DataStruct, i: number): number[] => (i < 0 ? data.time : data.values.map((r) => r[i]));
const fail = (error: string): BuildOutcome => ({ ok: false, error });

/** Fit Life by X has no smallest-extreme-value form (its life is not multiplicative in
 *  the stress), so that choice shows and runs as Weibull there. */
export function effectiveLifeDist(id: string, p: LifeParams): LifeDist {
  return id === "life-by-x" && p.distribution === "sev" ? "weibull" : p.distribution;
}

/** Worksheet columns the life tests read: time, censor (and the stress regressor). */
export function lifeColumns(id: string, sel: TestSelection): number[] {
  return id === "life-by-x" ? [sel.x, sel.y, sel.byCol] : [sel.x, sel.y];
}

/** Parse a comma / space separated list of numbers; a message if any entry is not one. */
export function parseNumberList(text: string): number[] | string {
  const parts = text.split(/[\s,;]+/).filter((s) => s !== "");
  const out = parts.map(Number);
  const badAt = out.findIndex((v) => !Number.isFinite(v));
  return badAt >= 0 ? `"${parts[badAt]}" is not a number.` : out;
}

/** Build the request for a life test, or say plainly what is wrong. */
export function buildLifeRequest(id: string, data: DataStruct | null, sel: TestSelection, tp: TestParams): BuildOutcome {
  if (!data) return fail("Select a dataset to analyze.");
  const p = tp.life;
  const name = (c: number) => columnDisplayName(data, c);
  const cols = lifeColumns(id, sel);
  if (cols.some((c, i) => cols.indexOf(c) !== i)) return fail("Pick different columns for time, censor and the stress variable.");
  const src = cols.map((c) => col(data, c));
  const keep: number[] = [];
  for (let i = 0; i < Math.min(...src.map((s) => s.length)); i++) if (src.every((s) => Number.isFinite(s[i]))) keep.push(i);
  const [time, censor, x] = src.map((s) => keep.map((i) => s[i]));
  if (!time || time.length === 0) return fail(`${name(sel.x)} and ${name(sel.y)} have no complete rows.`);
  if (time.some((v) => v < 0)) return fail(`${name(sel.x)} has negative times; life times cannot be negative.`);
  if (censor.some((v) => v !== 0 && v !== 1)) return fail(`${name(sel.y)} must hold only 0 (failed) and 1 (censored).`);
  const percents = parseNumberList(p.quantilesText);
  if (typeof percents === "string") return fail(`B-life percentages: ${percents}`);
  if (percents.some((v) => !(v > 0 && v < 100))) return fail("B-life percentages must be between 0 and 100 (10 means B10).");
  const probs = percents.map((v) => v / 100);
  const labels = cols.map(name);
  if (id === "life-by-x") {
    const body = {
      time, censor, x: x ?? [], distribution: effectiveLifeDist(id, p) as Exclude<LifeDist, "sev">,
      transform: p.transform, alpha: tp.alpha, quantile_probs: probs, ...(p.useX == null ? {} : { use_x: p.useX }),
    };
    return { ok: true, request: { id: "life-by-x", body } as StatsTestRequest, labels };
  }
  const times = parseNumberList(p.timesText);
  if (typeof times === "string") return fail(`Evaluation times: ${times}`);
  if (times.some((v) => v <= 0)) return fail("Evaluation times must be greater than 0.");
  const body = {
    time, censor, distribution: p.distribution, compare: p.compare, alpha: tp.alpha,
    quantile_probs: probs, eval_times: times, plotting: p.plotting,
  };
  return { ok: true, request: { id: "life-distribution", body } as StatsTestRequest, labels };
}

/** The life settings a result / input review shows (label, value). */
export function lifeSettings(id: string, tp: TestParams): [string, string][] {
  const p = tp.life;
  if (id === "life-by-x") {
    const d = effectiveLifeDist(id, p);
    return [
      ["Distribution", LIFE_DISTS.find((x) => x.id === d)?.label ?? d],
      ["Relationship", LIFE_TRANSFORMS.find((t) => t.id === p.transform)?.label ?? p.transform],
      ["Use condition", p.useX == null ? "not set" : String(p.useX)],
      ["B-lives (%)", p.quantilesText],
      ["Censor column", "1 = censored, 0 = failed"],
    ];
  }
  const out: [string, string][] = [
    ["Distribution", LIFE_DISTS.find((x) => x.id === p.distribution)?.label ?? p.distribution],
    ["Compare all families", p.compare ? "yes (AICc, BIC)" : "no"],
    ["Plotting positions", p.plotting === "kaplan-meier" ? "Kaplan-Meier midpoints" : "median ranks (Johnson / Benard)"],
    ["B-lives (%)", p.quantilesText],
    ["Censor column", "1 = censored, 0 = failed"],
  ];
  if (p.timesText.trim()) out.push(["Failure probability at", p.timesText]);
  return out;
}

const DIST_IDS: string[] = LIFE_DISTS.map((d) => d.id);
const TRANSFORM_IDS: string[] = LIFE_TRANSFORMS.map((t) => t.id);

/** Restore `life` from a saved record: absent -> defaults; present but invalid -> null. */
export function restoreLife(raw: unknown): LifeParams | null {
  if (raw === undefined) return DEFAULT_LIFE;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const ok =
    DIST_IDS.includes(String(r.distribution)) && typeof r.compare === "boolean" &&
    ["median-rank", "kaplan-meier"].includes(String(r.plotting)) &&
    typeof r.quantilesText === "string" && typeof r.timesText === "string" &&
    TRANSFORM_IDS.includes(String(r.transform)) &&
    (r.useX === null || (typeof r.useX === "number" && Number.isFinite(r.useX)));
  return ok ? (r as unknown as LifeParams) : null;
}
