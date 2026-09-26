// Metadata → factors — the COMMITS (PRIMARY_SOFTWARE_AUDIT_PLAN P2.5): promote
// a metadata field to a factor column, and apply a metadata cleanup plan. One
// path shared by the workshop (components/workshops/metafactors) and the
// pipeline replay (lib/transformRun's `runTransform` hands these two ops here),
// so a recorded step replays through the code that recorded it.
//
// Both act IN PLACE on their datasets (a factor is a new column of the dataset
// it describes; a cleanup edits its metadata), so the recorded `transform` step
// creates no output and a replay continues on the same target. Each commit is
// ONE undo entry however many datasets it touches, and records one step —
// replayed, it applies to the run's target (a template's file), which is what
// "promote `sample` on every file" means.
//
// Lazy: reached only from the workshop and the pipeline runner.

import { lit } from "./macro";
import { applyCleanup, planCleanup, type CleanupPlan, type CleanupResult, type LetterCase } from "./metadataCleanup";
import { factorColumn, planFactor, type FactorAs, type FactorPlan } from "./metadataFactor";
import { pathLabel, type MetaPath } from "./metadataKeys";
import { plural } from "./plural";
import { baseColumns } from "./formula";
import type { Dataset } from "./types";
import { withRecomputedFormulas } from "../store/computedColumns";
import { useApp, type AppState } from "../store/useApp";

type StoreGet = () => AppState;

export type MetaStepParams =
  | { op: "promote"; path: MetaPath; as: FactorAs; name: string }
  | ({ op: "metaclean" } & CleanupPlan);

/** Full (not preview) data for every id, in order; throws naming a dataset
 *  that is gone or cannot be loaded, rather than committing a subset. */
async function resolveAll(s: StoreGet, ids: readonly string[]): Promise<Dataset[]> {
  await s().resolveDatasets([...ids]);
  return ids.map((id) => {
    const d = s().datasets.find((x) => x.id === id);
    if (!d) throw new Error("a picked dataset is no longer in the workspace");
    if (d.pending) throw new Error(`the full data of “${d.name}” could not be loaded`);
    return d;
  });
}

const refs = (ds: readonly Dataset[]) => ds.map((d) => ({ id: d.id, name: d.name }));

export function metaStepLabel(p: MetaStepParams): string {
  if (p.op === "promote") return `Promote metadata ${pathLabel(p.path)} to factor column “${p.name}”`;
  const n = p.unify.length + p.normalize.length;
  return `Clean up metadata (${n} rule${plural(n)})`;
}

function record(s: StoreGet, p: MetaStepParams, applied: readonly Dataset[]): void {
  const { op, ...args } = p;
  s().recordMacro(metaStepLabel(p), `qz.transform(${lit(op)}, "<active>", ${lit(args)})`, {
    kind: "transform",
    params: { ...p, datasets: refs(applied) },
  });
}

export interface PromoteOutcome {
  plan: FactorPlan;
  note: string;
}

/** Add `name` — the metadata field at `path` — as a factor column to every
 *  dataset in `ids`. Throws (nothing changed) when the plan is blocked. */
export async function promoteFactor(
  s: StoreGet,
  ids: readonly string[],
  path: MetaPath,
  as: FactorAs | "auto",
  name: string,
): Promise<PromoteOutcome> {
  const targets = await resolveAll(s, ids);
  const plan = planFactor(targets, path, as, name);
  if (plan.blocked) throw new Error(plan.blocked);
  const cols = new Map(plan.rows.map((r) => [r.id, factorColumn(plan, r, path)]));
  s().recordHistory(`add factor “${plan.name}”`);
  useApp.setState((st) => ({
    datasets: st.datasets.map((d) => {
      const col = cols.get(d.id);
      if (!col) return d;
      const base = baseColumns(d.data, d.formulas?.length ?? 0);
      const formulas = [...(d.formulas ?? []), col];
      return { ...d, formulas, ...withRecomputedFormulas(base, formulas) };
    }),
  }));
  for (const id of cols.keys()) s().touchDataset(id);
  record(s, { op: "promote", path: [...path], as: plan.as, name: plan.name }, targets);
  const miss = plan.missing.length ? ` — no value (left blank) in ${plan.missing.join(", ")}` : "";
  const note = `added ${plan.as} factor “${plan.name}” to ${targets.length} dataset${plural(targets.length)}${miss}`;
  s().setStatus(note);
  return { plan, note };
}

export interface CleanupOutcome {
  result: CleanupResult;
  note: string;
}

/** Apply `plan` to the metadata of every dataset in `ids` (their `raw` too,
 *  so a corrections re-apply keeps it). Throws when nothing would change. */
export async function applyMetadataCleanup(s: StoreGet, ids: readonly string[], plan: CleanupPlan): Promise<CleanupOutcome> {
  const targets = await resolveAll(s, ids);
  const result = planCleanup(targets, plan);
  const count = result.datasets.reduce((n, d) => n + d.changes.length, 0);
  if (!count) throw new Error(result.refusals.length ? `nothing changed: ${result.refusals.join(" ")}` : "nothing to change");
  const at = new Date().toISOString();
  const byId = new Map(result.datasets.map((d) => [d.id, d.changes]));
  s().recordHistory("clean up metadata");
  useApp.setState((st) => ({
    datasets: st.datasets.map((d) => {
      const changes = byId.get(d.id);
      if (!changes) return d;
      const data = { ...d.data, metadata: applyCleanup(d.data.metadata, changes, at) };
      return d.raw ? { ...d, data, raw: { ...d.raw, metadata: applyCleanup(d.raw.metadata, changes, at) } } : { ...d, data };
    }),
  }));
  record(s, { op: "metaclean", unify: plan.unify, normalize: plan.normalize }, targets);
  const refused = result.refusals.length ? ` (${result.refusals.length} refused: ${result.refusals.join(" ")})` : "";
  const note = `cleaned metadata: ${count} change${plural(count)} in ${result.datasets.length} dataset${plural(result.datasets.length)}${refused}`;
  s().setStatus(note);
  return { result, note };
}

/** Replay one recorded step on `targetId`. */
export async function runMetaStep(s: StoreGet, p: MetaStepParams, targetId: string): Promise<string> {
  if (p.op === "promote") return (await promoteFactor(s, [targetId], p.path, p.as, p.name)).note;
  return (await applyMetadataCleanup(s, [targetId], { unify: p.unify, normalize: p.normalize })).note;
}

const CASES: readonly LetterCase[] = ["keep", "lower", "upper"];
const isPath = (v: unknown): v is MetaPath =>
  Array.isArray(v) && v.length > 0 && v.every((k) => typeof k === "string" && k !== "");

/** Validate a recorded step's params (a .dwk / template is user-editable). */
export function metaParamsOf(raw: Record<string, unknown>): MetaStepParams {
  if (raw.op === "promote") {
    const as = raw.as;
    if (!isPath(raw.path)) throw new Error('transform "promote" needs a metadata "path"');
    if (as !== "categorical" && as !== "numeric") throw new Error(`unknown factor type "${String(as)}"`);
    if (typeof raw.name !== "string" || !raw.name.trim()) throw new Error('transform "promote" needs a column "name"');
    return { op: "promote", path: raw.path, as, name: raw.name };
  }
  const unify = Array.isArray(raw.unify) ? raw.unify : [];
  const normalize = Array.isArray(raw.normalize) ? raw.normalize : [];
  return {
    op: "metaclean",
    unify: unify.map((u: Record<string, unknown>) => {
      if (typeof u?.to !== "string" || !Array.isArray(u.from) || !u.from.every(isPath)) {
        throw new Error('transform "metaclean" has a malformed unify rule');
      }
      return { to: u.to, from: u.from as MetaPath[] };
    }),
    normalize: normalize.map((n: Record<string, unknown>) => {
      if (typeof n?.key !== "string" || !CASES.includes(n.letterCase as LetterCase)) {
        throw new Error('transform "metaclean" has a malformed normalize rule');
      }
      return { key: n.key, trim: n.trim === true, letterCase: n.letterCase as LetterCase, units: n.units === true };
    }),
  };
}
