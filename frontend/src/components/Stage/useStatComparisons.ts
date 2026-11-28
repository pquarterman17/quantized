// The Stat Stage's significance brackets / compact letters (gap audit 8 lane
// SIG): runs the EXISTING post-hoc endpoints (`/api/stats/tukey`,
// `/api/stats/dunnett`) over the plotted groups and stamps the laid-out
// result onto the draw, so the canvas paints it and the export posts the same
// geometry (`statCompareLayout`). Opt-in (`marks.comparisons`); off, this does
// nothing at all — no request, the draw returned untouched.
//
// FAIL CLOSED: anything that makes the comparison ambiguous draws NOTHING and
// says why (`error`), never a partial or guessed mark:
//   * faceted plots (each panel is its own test family);
//   * bar mode unless it is ONE series, grouped, with no fixed value range
//     (several series / a stack have no single "groups" to compare), and its
//     bars' n must match the tested groups'; every plot's drawn groups must
//     match the tested ones (`alignGroups`);
//   * fewer than 2 groups, or a group with < 2 values (the endpoints' own rule);
//   * letters with Dunnett (it does not test every pair);
//   * a Dunnett control label that is no longer a group.
// The tested groups are the draw's own finite groups, i.e. they respect row
// exclusion and the local filter exactly like the plot does.

import { useEffect, useMemo, useState } from "react";

import { statsTukey } from "../../lib/api";
import { sigOutcome } from "../../lib/sigSource";
import { useApp } from "../../store/useApp";
import { statsDunnett } from "../../lib/api/statsTests";
import {
  buildComparisons, COMPARE_ALPHA, refusal, type PairP, type StatComparisonsResult,
} from "../../lib/statComparisons";
import type { ResolvedStatMarks } from "../../lib/statMarks";
import type { GroupSpec } from "../../lib/statschooser";
import { resolveGroups, type StatMode } from "../../lib/statstage";
import type { AnalysisResult } from "../../lib/analysisResult";
import type { DataStruct, Dataset } from "../../lib/types";
import { alignGroups, isCategorical, layoutComparisons } from "./statCompareLayout";
import type { StatDrawData } from "./statRender";

export interface StatComparisonsParams {
  mode: StatMode;
  marks: ResolvedStatMarks;
  /** The flat draw with its marks (null while computing). */
  draw: StatDrawData | null;
  faceted: boolean;
  /** Box / violin / strip's finite groups (their own compute's). */
  groups: readonly GroupSpec[];
  /** Bar mode's inputs: the dataset view, the group column, and the plot's series. */
  data: DataStruct | null;
  groupCol: number | null;
  valueCol: number;
  plotted: readonly number[];
  barSeries: number;
  barStack: boolean;
}

export interface StatComparisonsState {
  /** `draw` with `comparisons` stamped on (the same object when off / refused). */
  draw: StatDrawData | null;
  /** The test-and-correction sentence for the footnote, or null. */
  note: string | null;
  /** Why nothing is drawn although comparisons are on, or null. */
  error: string | null;
  /** The compared groups' labels (the Dunnett control picker's options). */
  labels: string[];
}

const NO_GROUPS: GroupSpec[] = [];
const NO_RESULTS: AnalysisResult[] = [];
const NO_DATASETS: Dataset[] = [];
const mean = (v: readonly number[]) => v.reduce((s, x) => s + x, 0) / v.length;

/** Why `groups` cannot be compared, or null. */
export function groupsRefusal(groups: readonly GroupSpec[]): string | null {
  if (groups.length < 2) return "Comparisons need at least 2 groups";
  const small = groups.find((g) => g.values.length < 2);
  return small ? `Comparisons need at least 2 values per group ("${small.label}" has ${small.values.length})` : null;
}

/** Run the test and return the drawn-independent result, or `{ error }`. */
export async function runComparisons(
  groups: readonly GroupSpec[], marks: ResolvedStatMarks, signal?: { cancelled: boolean },
): Promise<StatComparisonsResult | { error: string }> {
  if (marks.comparisons === "off") return { error: "off" };
  const values = groups.map((g) => g.values as number[]);
  let pairs: PairP[];
  let control: string | null = null;
  if (marks.compareMethod === "tukey") {
    const r = (await statsTukey(values, COMPARE_ALPHA)) as { pairs?: { i: number; j: number; p: number }[] };
    pairs = (r.pairs ?? []).map((q) => ({ a: q.i, b: q.j, p: q.p }));
  } else {
    const at = marks.compareControl === null ? 0 : groups.findIndex((g) => g.label === marks.compareControl);
    if (at < 0) return { error: `Dunnett control "${marks.compareControl}" is not a plotted group` };
    control = groups[at].label;
    const r = await statsDunnett({ groups: values, control: at, alpha: COMPARE_ALPHA, alternative: "two-sided" });
    pairs = r.comparisons.map((q) => ({ a: at, b: q.group, p: q.p }));
  }
  if (signal?.cancelled) return { error: "cancelled" };
  if (!pairs.length || pairs.some((q) => !Number.isFinite(q.p))) return { error: "The test returned no usable p-values" };
  return buildComparisons(marks.compareMethod, marks.comparisons, marks.compareExact, groups.map((g) => mean(g.values)), pairs, control);
}

export function useStatComparisons(p: StatComparisonsParams): StatComparisonsState {
  const { mode, marks, draw, faceted, groups, data, groupCol, valueCol, plotted, barSeries, barStack } = p;
  const categorical = mode === "box" || mode === "violin" || mode === "strip" || mode === "bar";
  // Supplied p-values (`marks.sig`) replace the inline test: nothing is run for them.
  const given = !!marks.sig && categorical;
  const on = (marks.comparisons !== "off" || given) && categorical;
  const inline = on && !given;
  const sigKey = given ? JSON.stringify(marks.sig) : ""; // resolveStatMarks builds a fresh object per call
  const results = useApp((s) => (given ? s.analysisResults : NO_RESULTS));
  const datasets = useApp((s) => (given ? s.datasets : NO_DATASETS));
  const barGroups = useMemo<GroupSpec[]>(
    () => (on && mode === "bar" && data && groupCol != null ? resolveGroups(data, groupCol, valueCol, plotted).filter((g) => g.values.length > 0) : []),
    [on, mode, data, groupCol, valueCol, plotted],
  );
  const boxGroups = useMemo(() => groups.filter((g) => g.values.length > 0), [groups]);
  // Stable identity per input (the effect below restarts when it changes).
  const tested = !on ? NO_GROUPS : mode === "bar" ? barGroups : boxGroups;
  const fixedRange = draw?.mode === "bar" && !!draw.valueRange;
  const blocked = !on ? null
    : faceted ? "Comparisons are not drawn on faceted plots (each panel is its own test)"
    : mode === "bar" && (barStack || barSeries !== 1 || groupCol == null || fixedRange)
      ? "Bar comparisons need grouped bars, one series, a group column and an automatic value range"
      : given ? (tested.length < 2 ? "Significance marks need at least 2 groups" : null)
      : refusal(marks.compareMethod, marks.comparisons) ?? groupsRefusal(tested);

  const key = `${marks.compareMethod}|${marks.comparisons}|${marks.compareControl}|${marks.compareExact}`;
  const [done, setDone] = useState<{ groups: readonly GroupSpec[]; key: string; out: StatComparisonsResult | { error: string } } | null>(null);
  useEffect(() => {
    if (!inline || blocked) return;
    const flag = { cancelled: false };
    runComparisons(tested, marks, flag)
      .then((out) => !flag.cancelled && setDone({ groups: tested, key, out }))
      .catch((e: unknown) => !flag.cancelled && setDone({ groups: tested, key, out: { error: e instanceof Error ? e.message : "comparison failed" } }));
    return () => {
      flag.cancelled = true;
    };
    // `marks` is read through `key` (every field runComparisons reads is in it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inline, blocked, tested, key]);

  return useMemo<StatComparisonsState>(() => {
    const labels = tested.map((g) => g.label);
    if (!on) return { draw, note: null, error: null, labels };
    if (blocked) return { draw, note: null, error: blocked, labels };
    const out = given && marks.sig ? sigOutcome(marks.sig, tested, { results, datasets })
      : done && done.groups === tested && done.key === key ? done.out : null;
    if (!out) return { draw, note: null, error: null, labels };
    if ("error" in out) return { draw, note: null, error: out.error === "cancelled" ? null : out.error, labels };
    if (!isCategorical(draw)) return { draw, note: null, error: null, labels };
    const idx = alignGroups(draw, tested);
    if (!idx) return { draw, note: null, error: "The plotted groups changed; comparison skipped", labels };
    const comparisons = layoutComparisons(draw, out, idx);
    return { draw: { ...draw, comparisons }, note: out.note, error: null, labels };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, blocked, done, tested, key, draw, given, sigKey, results, datasets]);
}
