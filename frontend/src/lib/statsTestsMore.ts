// Statistical-tests workshop — hypothesis-test completion (GAP_AUDIT_9 G6): the
// catalog entries, the extra parameters and the pure request builder for Welch
// ANOVA, post hoc comparisons, variance tests, equivalence (TOST), tolerance
// intervals and proportion tests. Delegated to by statsTests.ts so that file
// stays small. Row rules follow the existing tests: independent groups / samples
// keep each column's own finite values; a paired TOST keeps rows where BOTH
// columns are finite so each surviving row is still one pair.
//
// Provisional, owner to confirm: no default equivalence margin and no default
// counts (the user must set them: a wrong default would silently answer a
// different question); p0 defaults to 0.5, alpha to 0.05, tolerance to 90%
// coverage at 95% confidence.

import type { StatsTestId, StatsTestRequest } from "./api/statsTests";
import { columnDisplayName, groupsByCategory, groupsFromColumns } from "./statschooser";
import type { DataStruct } from "./types";
import type { BuildOutcome, TestDef, TestParams, TestSelection } from "./statsTests";

export type PosthocMethod = "tukey" | "games-howell" | "scheffe" | "lsd";
export type VarianceMethod = "bartlett" | "levene" | "brown-forsythe" | "f-test";

/** Extra parameters of the G6 tests; `null` = not yet set by the user. */
export type MoreParams = {
  posthoc: PosthocMethod;
  variance: VarianceMethod;
  /** Equivalence margin: the true difference may be at most this far from 0 (or from mu0). */
  margin: number | null;
  mu0: number;
  tostDesign: "welch" | "pooled" | "paired";
  coverage: number;
  confidence: number;
  tiSides: "two" | "upper" | "lower";
  /** Summary counts: successes and trials per group (group 1 only for the one-sample test). */
  x1: number | null; n1: number | null; x2: number | null; n2: number | null;
  p0: number;
  propMethod: "exact" | "normal";
};

export const DEFAULT_MORE: MoreParams = {
  posthoc: "games-howell", variance: "bartlett", margin: null, mu0: 0, tostDesign: "welch",
  coverage: 0.9, confidence: 0.95, tiSides: "two",
  x1: null, n1: null, x2: null, n2: null, p0: 0.5, propMethod: "exact",
};

export const MORE_TESTS: readonly TestDef[] = [
  { id: "welch-anova", family: "Compare groups", label: "Welch ANOVA", input: "groups", blurb: "Do group means differ when the groups may have unequal variances?" },
  { id: "posthoc", family: "Compare groups", label: "Post hoc pairwise comparisons", input: "groups", blurb: "Which pairs of groups differ: Games-Howell, Tukey, Scheffé or Fisher LSD?" },
  { id: "variance-test", family: "Variances", label: "Equal-variance tests", input: "groups", blurb: "Do the groups have the same spread: Bartlett, Levene, Brown-Forsythe or the two-sample F test?" },
  { id: "tost-one", family: "Equivalence", label: "Equivalence, one sample (TOST)", input: "one", blurb: "Is the mean within a margin of a target value?" },
  { id: "tost-two", family: "Equivalence", label: "Equivalence, two samples (TOST)", input: "two", blurb: "Are two means closer than an equivalence margin (is the new process equivalent to the old)?" },
  { id: "tolerance-interval", family: "Intervals", label: "Normal tolerance interval", input: "one", blurb: "Limits that contain a chosen share of the population with a chosen confidence." },
  { id: "binomial-test", family: "Proportions", label: "One proportion (binomial)", input: "none", blurb: "Does a success rate differ from a hypothesised value? Enter the counts." },
  { id: "two-proportions", family: "Proportions", label: "Two proportions (z test)", input: "none", blurb: "Do two success rates differ? Enter the counts." },
  { id: "fisher-2x2", family: "Proportions", label: "Fisher exact test (2×2)", input: "none", blurb: "Exact test for a 2×2 table of successes and failures, small counts allowed." },
];

export const MORE_IDS: ReadonlySet<StatsTestId> = new Set(MORE_TESTS.map((t) => t.id));

/** Tests of the G6 family that read no alpha (tolerance uses coverage / confidence). */
export const MORE_NO_ALPHA: ReadonlySet<StatsTestId> = new Set<StatsTestId>(["tolerance-interval"]);

const finite = (xs: number[]): number[] => xs.filter((v) => Number.isFinite(v));
const col = (data: DataStruct, i: number): number[] => (i < 0 ? data.time : data.values.map((r) => r[i]));
const fail = (error: string): BuildOutcome => ({ ok: false, error });

function countsProblem(m: MoreParams, two: boolean): string | null {
  const pairs: [string, number | null, number | null][] = [["group 1", m.x1, m.n1], ...(two ? [["group 2", m.x2, m.n2] as [string, number | null, number | null]] : [])];
  for (const [name, x, n] of pairs) {
    if (x == null || n == null) return `Enter the successes and trials for ${name}.`;
    if (!Number.isInteger(x) || !Number.isInteger(n) || x < 0 || n < 1) return `${name}: successes and trials must be whole numbers (trials at least 1).`;
    if (x > n) return `${name}: successes (${x}) cannot exceed trials (${n}).`;
  }
  return null;
}

function marginProblem(m: MoreParams): string | null {
  return m.margin == null || !(m.margin > 0) ? "Set an equivalence margin greater than 0: how large a difference still counts as equivalent." : null;
}

/** Build the request for a G6 test, or say plainly what is missing. */
export function buildMoreRequest(
  id: StatsTestId, data: DataStruct | null, sel: TestSelection, p: TestParams,
): BuildOutcome {
  const m = p.more;
  if (id === "binomial-test" || id === "two-proportions" || id === "fisher-2x2") {
    const two = id !== "binomial-test";
    const bad = countsProblem(m, two);
    if (bad) return fail(bad);
    if (!two) {
      const body = { successes: m.x1 as number, trials: m.n1 as number, p0: m.p0, method: m.propMethod, alternative: p.alternative, alpha: p.alpha };
      return { ok: true, request: { id, body }, labels: [] };
    }
    const body = { x1: m.x1 as number, n1: m.n1 as number, x2: m.x2 as number, n2: m.n2 as number, alternative: p.alternative, alpha: p.alpha };
    return { ok: true, request: { id, body } as StatsTestRequest, labels: [] };
  }
  if (!data) return fail("Select a dataset to analyze.");
  const name = (c: number) => columnDisplayName(data, c);
  switch (id) {
    case "welch-anova":
    case "posthoc":
    case "variance-test": {
      const groups = sel.groupMode === "category"
        ? (sel.x === sel.byCol ? [] : groupsByCategory(data, sel.x, sel.byCol))
        : groupsFromColumns(data, sel.cols);
      if (groups.length < 2) return fail("Pick at least 2 groups.");
      const thin = groups.find((g) => g.values.length < 2);
      if (thin) return fail(`Group "${thin.label}" has fewer than 2 usable values; every group needs at least 2.`);
      if (id === "variance-test" && m.variance === "f-test" && groups.length !== 2) return fail("The F test compares exactly 2 groups; use Bartlett, Levene or Brown-Forsythe for more.");
      const values = groups.map((g) => g.values);
      const labels = groups.map((g) => g.label);
      if (id === "welch-anova") return { ok: true, request: { id, body: { groups: values, alpha: p.alpha } }, labels };
      if (id === "posthoc") return { ok: true, request: { id, body: { groups: values, method: m.posthoc, alpha: p.alpha } }, labels };
      return { ok: true, request: { id, body: { groups: values, method: m.variance, alpha: p.alpha } }, labels };
    }
    case "tost-one": {
      const bad = marginProblem(m);
      if (bad) return fail(bad);
      return { ok: true, request: { id, body: { x: finite(col(data, sel.x)), mu0: m.mu0, margin: m.margin as number, alpha: p.alpha } }, labels: [name(sel.x)] };
    }
    case "tost-two": {
      const bad = marginProblem(m);
      if (bad) return fail(bad);
      if (sel.x === sel.y) return fail("Pick two different columns.");
      const paired = m.tostDesign === "paired";
      const [x, y] = paired
        ? (() => {
          const a = col(data, sel.x), b = col(data, sel.y);
          const keep = a.map((v, i) => i < b.length && Number.isFinite(v) && Number.isFinite(b[i]));
          return [a.filter((_, i) => keep[i]), b.filter((_, i) => i < a.length && keep[i])];
        })()
        : [finite(col(data, sel.x)), finite(col(data, sel.y))];
      return { ok: true, request: { id, body: { x, y, design: m.tostDesign, margin: m.margin as number, alpha: p.alpha } }, labels: [name(sel.x), name(sel.y)] };
    }
    case "tolerance-interval": {
      if (!(m.coverage > 0 && m.coverage < 1) || !(m.confidence > 0 && m.confidence < 1)) return fail("Coverage and confidence must each be between 0 and 1.");
      return { ok: true, request: { id, body: { x: finite(col(data, sel.x)), coverage: m.coverage, confidence: m.confidence, sides: m.tiSides } }, labels: [name(sel.x)] };
    }
    default:
      return fail(`Unknown test "${id}".`);
  }
}

const POSTHOC_NAMES: Record<PosthocMethod, string> = { "games-howell": "Games-Howell", tukey: "Tukey HSD", scheffe: "Scheffé", lsd: "Fisher LSD (no correction)" };
const VARIANCE_NAMES: Record<VarianceMethod, string> = { bartlett: "Bartlett", levene: "Levene (mean)", "brown-forsythe": "Brown-Forsythe (median)", "f-test": "F test (2 groups)" };
const setOrBlank = (v: number | null): string => (v == null ? "not set" : String(v));

/** The G6 settings a result / input review shows for `id` (label, value). */
export function moreSettings(id: StatsTestId, p: TestParams): [string, string][] {
  const m = p.more;
  switch (id) {
    case "posthoc": return [["Method", POSTHOC_NAMES[m.posthoc]]];
    case "variance-test": return [["Method", VARIANCE_NAMES[m.variance]]];
    case "tost-one": return [["Target value", String(m.mu0)], ["Equivalence margin (±)", setOrBlank(m.margin)]];
    case "tost-two": return [["Design", m.tostDesign], ["Equivalence margin (±)", setOrBlank(m.margin)]];
    case "tolerance-interval": return [["Coverage", String(m.coverage)], ["Confidence", String(m.confidence)], ["Limits", m.tiSides]];
    case "binomial-test": return [["Successes", setOrBlank(m.x1)], ["Trials", setOrBlank(m.n1)], ["Hypothesised p0", String(m.p0)], ["Method", m.propMethod], ["Alternative", p.alternative]];
    case "two-proportions":
    case "fisher-2x2": return [["Group 1 (successes / trials)", `${setOrBlank(m.x1)} / ${setOrBlank(m.n1)}`], ["Group 2 (successes / trials)", `${setOrBlank(m.x2)} / ${setOrBlank(m.n2)}`], ["Alternative", p.alternative]];
    default: return [];
  }
}

const NUM_OR_NULL = (v: unknown): boolean => v === null || (typeof v === "number" && Number.isFinite(v));

/** Restore `more` from a saved record: a result saved before G6 has none (defaults);
 *  a present-but-invalid record returns null so the recipe is not reopened ambiguously. */
export function restoreMore(raw: unknown): MoreParams | null {
  if (raw === undefined) return DEFAULT_MORE;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const ok =
    ["games-howell", "tukey", "scheffe", "lsd"].includes(String(r.posthoc)) &&
    ["bartlett", "levene", "brown-forsythe", "f-test"].includes(String(r.variance)) &&
    ["welch", "pooled", "paired"].includes(String(r.tostDesign)) &&
    ["two", "upper", "lower"].includes(String(r.tiSides)) &&
    ["exact", "normal"].includes(String(r.propMethod)) &&
    [r.margin, r.x1, r.n1, r.x2, r.n2].every(NUM_OR_NULL) &&
    [r.mu0, r.coverage, r.confidence, r.p0].every((v) => typeof v === "number" && Number.isFinite(v));
  return ok ? (r as unknown as MoreParams) : null;
}
