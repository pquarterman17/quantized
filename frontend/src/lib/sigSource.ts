// Where significance marks get their p-values (plan item 23), and the check
// that the source's groups ARE the plot's groups. Pure. Two sources, no
// default: a saved post-hoc statistics result, or three worksheet columns
// (group A, group B, p). Every refusal names what is wrong.

import type { AnalysisResult } from "./analysisResult";
import { resolveCategoryLabels } from "./barlayout";
import { categoryLevels, isCategoricalChannel } from "./categorical";
import { sigLabel, sigNote, type SigMarks } from "./sigMarks";
import type { PairP, StatComparisonsResult } from "./statComparisons";
import type { GroupSpec } from "./statschooser";
import type { Dataset } from "./types";

/** One tested pair by group NAME, with where it came from (for messages). */
export interface NamedPair { a: string; b: string; p: number; where: string }

type Out<T> = T | { error: string };
const MINUS = " − "; // the post-hoc table's "A − B"

const quoted = (names: readonly string[]) => names.map((n) => `"${n}"`).join(", ");

/** The pairs of a saved post-hoc result, by name. */
export function pairsFromResult(r: AnalysisResult): Out<{ pairs: NamedPair[]; method: string }> {
  const params = r.parameters as { testId?: unknown; labels?: unknown; params?: { more?: { posthoc?: unknown } } } | undefined;
  if (r.producer.id !== "statistical-test" || params?.testId !== "posthoc") {
    return { error: `"${r.name}" is not a post-hoc comparison result (run Statistical tests > Post hoc pairwise comparisons)` };
  }
  const labels = Array.isArray(params.labels) ? params.labels.filter((l): l is string => typeof l === "string") : [];
  const isP = (c: string) => c === "p" || c.startsWith("p (");
  const table = (r.tables ?? []).find((t) => t.columns.includes("pair") && t.columns.some(isP));
  if (!table || labels.length < 2) return { error: `"${r.name}" holds no pairwise p-value table` };
  const pc = table.columns.findIndex(isP);
  const kc = table.columns.indexOf("pair");
  const known = new Set(labels);
  const pairs: NamedPair[] = [];
  for (const [i, row] of table.rows.entries()) {
    const text = String(row[kc]);
    let at = text.indexOf(MINUS);
    let hit: [string, string] | null = null;
    while (at >= 0 && !hit) {
      const [x, y] = [text.slice(0, at), text.slice(at + MINUS.length)];
      if (known.has(x) && known.has(y)) hit = [x, y];
      at = text.indexOf(MINUS, at + 1);
    }
    const p = row[pc];
    if (!hit) return { error: `"${r.name}": cannot read the pair "${text}" (table row ${i + 1})` };
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) return { error: `"${r.name}": the p-value of "${text}" is missing or outside 0..1` };
    pairs.push({ a: hit[0], b: hit[1], p, where: `table row ${i + 1}` });
  }
  const m = params.params?.more?.posthoc;
  return { pairs, method: typeof m === "string" ? m : "post hoc" };
}

/** The pairs of a worksheet: group A, group B (text columns) and p. Rows are
 *  SOURCE rows (1-based, as the sheet numbers them). */
export function pairsFromSheet(ds: Dataset, a: number, b: number, pc: number): Out<NamedPair[]> {
  if (ds.pending) return { error: `"${ds.name}" is not fully loaded yet; open the sheet, then pick it again` };
  const d = ds.data;
  if (new Set([a, b, pc]).size < 3 || [a, b, pc].some((c) => c < 0 || c >= d.labels.length)) {
    return { error: "Pick three different columns: group A, group B and p-value" };
  }
  for (const [c, what] of [[a, "Group A"], [b, "Group B"]] as const) {
    if (!isCategoricalChannel(d, c)) return { error: `${what} column "${d.labels[c]}" must be a text column of group names` };
  }
  if (isCategoricalChannel(d, pc)) return { error: `p-value column "${d.labels[pc]}" must be numeric` };
  const name = (c: number) => {
    const levels = categoryLevels(d, c);
    const names = resolveCategoryLabels(d, c, levels);
    return (v: number) => names[levels.indexOf(v)];
  };
  const [na, nb] = [name(a), name(b)];
  const pairs: NamedPair[] = [];
  for (const [i, row] of d.values.entries()) {
    const [x, y, p] = [na(row[a]), nb(row[b]), row[pc]];
    if (x === undefined && y === undefined && !Number.isFinite(p)) continue; // an empty row
    if (x === undefined || y === undefined) return { error: `Row ${i + 1}: group A or B is empty` };
    if (!Number.isFinite(p) || p < 0 || p > 1) return { error: `Row ${i + 1}: the p-value must be a number from 0 to 1` };
    pairs.push({ a: x, b: y, p, where: `row ${i + 1}` });
  }
  return pairs.length ? pairs : { error: `"${ds.name}" has no rows to read` };
}

/** Which plot group a source name is: the plot's own label ("grp = A"), or its
 *  level text ("A") when that is unambiguous. */
function plotIndex(name: string, labels: readonly string[]): number {
  const exact = labels.indexOf(name);
  if (exact >= 0) return exact;
  const tails = labels.map((l) => { const i = l.indexOf(" = "); return i >= 0 ? l.slice(i + 3) : l; });
  const hits = tails.flatMap((t, i) => (t === name ? [i] : []));
  return hits.length === 1 ? hits[0] : -1;
}

/** The source's pairs as indices into the plot's groups, or the refusal naming
 *  every source group the plot lacks and every plot group the source lacks. */
export function matchPairs(pairs: readonly NamedPair[], plotLabels: readonly string[]): Out<PairP[]> {
  const extra = new Set<string>();
  const seen = new Set<number>();
  const out = new Map<string, PairP & { where: string }>();
  for (const q of pairs) {
    const [a, b] = [plotIndex(q.a, plotLabels), plotIndex(q.b, plotLabels)];
    if (a < 0) extra.add(q.a);
    if (b < 0) extra.add(q.b);
    if (a < 0 || b < 0) continue;
    if (a === b) return { error: `${q.where}: "${q.a}" is paired with itself` };
    seen.add(a);
    seen.add(b);
    const key = `${Math.min(a, b)}|${Math.max(a, b)}`;
    const prev = out.get(key);
    if (prev && Math.abs(prev.p - q.p) > 1e-12) return { error: `"${q.a}" vs "${q.b}" has two different p-values (${prev.where} and ${q.where})` };
    if (!prev) out.set(key, { a, b, p: q.p, where: q.where });
  }
  const missing = plotLabels.filter((_, i) => !seen.has(i));
  if (extra.size || missing.length) {
    const parts = [
      extra.size ? `the source names ${quoted([...extra])}, which the plot does not have` : "",
      missing.length ? `the source has no p-values for the plot's ${quoted(missing)}` : "",
    ].filter(Boolean);
    return { error: `The p-value source does not match the plotted groups: ${parts.join("; ")}` };
  }
  return [...out.values()].map(({ a, b, p }) => ({ a, b, p }));
}

/** The whole path: source -> pairs -> the layout input (or the refusal). */
export function sigOutcome(
  sig: SigMarks, tested: readonly GroupSpec[],
  state: { results: readonly AnalysisResult[]; datasets: readonly Dataset[] },
): Out<StatComparisonsResult> {
  const s = sig.source;
  let named: Out<{ pairs: NamedPair[]; from: string }>;
  if (s.kind === "result") {
    if (!s.resultId) return { error: "Pick a post-hoc statistics result for the p-values" };
    const r = state.results.find((x) => x.id === s.resultId);
    if (!r) return { error: "The chosen statistics result no longer exists; pick another" };
    const got = pairsFromResult(r);
    named = "error" in got ? got : { pairs: got.pairs, from: `${r.name} (${got.method}${got.method === "lsd" ? ", not adjusted" : ""})` };
  } else {
    if (!s.datasetId || s.a < 0 || s.b < 0 || s.p < 0) return { error: "Pick the worksheet and its group A, group B and p-value columns" };
    const ds = state.datasets.find((x) => x.id === s.datasetId);
    if (!ds) return { error: "The chosen worksheet no longer exists; pick another" };
    const got = pairsFromSheet(ds, s.a, s.b, s.p);
    named = "error" in got ? got : { pairs: got, from: `worksheet ${ds.name}` };
  }
  if ("error" in named) return named;
  const pairs = matchPairs(named.pairs, tested.map((g) => g.label));
  if ("error" in pairs) return pairs;
  return {
    method: "given", display: "brackets", exact: sig.showP, pairs, letters: null,
    note: sigNote(named.from, sig), label: (p) => sigLabel(p, sig),
  };
}
