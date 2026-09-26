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
// `s` is the store getter every caller passes as `useApp.getState` (the
// runTransform convention); the writes go through `useApp.setState`, the
// store/recode.ts precedent, since the store has no generic dataset setter.
//
// Lazy: reached only from the workshop and the pipeline runner.

import { lit } from "./macro";
import { applyCleanup, planCleanup, type CleanupPlan, type CleanupResult, type LetterCase } from "./metadataCleanup";
import { factorColumn, planFactor, type FactorAs, type FactorPlan } from "./metadataFactor";
import { isScalar, pathLabel, type MetaPath, type MetaScalar } from "./metadataKeys";
import { plural } from "./plural";
import { applyFormulas, formulaErrors } from "./formula";
import { asAlreadyComputed, baseColumns, carryComputedLevelOrder } from "./formulaInputs";
import type { ComputedColumn, Dataset } from "./types";
import { useApp, type AppState } from "../store/useApp";

type StoreGet = () => AppState;

export type MetaStepParams =
  | { op: "promote"; path: MetaPath; as: FactorAs; name: string }
  | ({ op: "metaclean" } & CleanupPlan);

/** The op names `MetaStepParams` covers — ops that edit their dataset IN
 *  PLACE and create no output (module doc above). The one shared source
 *  (finding #7) for what used to be scattered `op === "promote" || op ===
 *  "metaclean"` checks: `lib/transformRun.ts`'s `isInPlaceOp` wraps this for
 *  its own typed narrowing, and `PipelinePanel.tsx` reads it directly — a
 *  lighter import than pulling in all of `lib/transformRun.ts` (datasetAlgebra,
 *  worksheetTransforms, …) just for two literal strings. */
export const IN_PLACE_OPS: ReadonlySet<string> = new Set<MetaStepParams["op"]>(["promote", "metaclean"]);

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

/** The label + `qz.transform()` code line for a promote/metaclean step — the
 *  ONE place that builds it (finding #8: `record()` below used to
 *  reimplement this by hand, and `lib/transformRun.ts`'s `transformStepText`
 *  — the generic dispatcher for every OTHER transform op — carried a second,
 *  never-reached copy of the same shape for these two ops, since `runTransform`
 *  handles them before it ever gets there). `transformStepText` delegates to
 *  this for promote/metaclean instead of repeating it; it cannot be the other
 *  way around (`record` calling it) — `transformRun.ts` imports FROM this
 *  module for `MetaStepParams`, so the reverse import would cycle. */
export function metaStepText(p: MetaStepParams): { label: string; code: string } {
  const { op, ...args } = p;
  return { label: metaStepLabel(p), code: `qz.transform(${lit(op)}, "<active>", ${lit(args)})` };
}

function record(s: StoreGet, p: MetaStepParams, applied: readonly Dataset[]): void {
  const { label, code } = metaStepText(p);
  s().recordMacro(label, code, { kind: "transform", params: { ...p, datasets: refs(applied) } });
}

export interface PromoteOutcome {
  plan: FactorPlan;
  note: string;
}

/** Append `col` to `d`'s formulas and recompute — like
 *  `store/computedColumns.ts`'s `withRecomputedFormulas`, but carrying
 *  forward any user-set `level_order` on the EXISTING computed columns
 *  (finding #2). That helper's own recompute path, `lib/formula.ts`'s
 *  `recomputeWithErrors`, strips `formulas.length` columns off `data` before
 *  reapplying the SAME (unchanged) list — right for a plain recompute, but
 *  `formulas` here is one LONGER than what `d.data` actually carries (the
 *  newly-appended factor), so that strip would eat a real base column
 *  instead. Stripping by the OLD count (as `withRecomputedFormulas` does)
 *  and then calling `carryComputedLevelOrder` directly gets both right. */
function appendFactorColumn(d: Dataset, col: ComputedColumn): Pick<Dataset, "formulas" | "data" | "formulaErrors"> {
  const base = baseColumns(d.data, d.formulas?.length ?? 0);
  const formulas = [...(d.formulas ?? []), col];
  const data = carryComputedLevelOrder(asAlreadyComputed(d.data), applyFormulas(base, formulas));
  const errors = formulaErrors(base, formulas);
  return { formulas, data, formulaErrors: Object.keys(errors).length ? errors : undefined };
}

/** Add `name` — the metadata field at `path` — as a factor column to every
 *  dataset in `ids`. Throws (nothing changed) when the plan is blocked. */
export async function promoteFactor(
  s: StoreGet,
  ids: readonly string[],
  path: MetaPath,
  as: FactorAs | "auto",
  name: string,
  replay = false,
): Promise<PromoteOutcome> {
  const targets = await resolveAll(s, ids);
  const plan = planFactor(targets, path, as, name, replay);
  if (plan.blocked) throw new Error(plan.blocked);
  const cols = new Map(plan.rows.map((r) => [r.id, factorColumn(plan, r, path)]));
  s().recordHistory(`add factor “${plan.name}”`);
  useApp.setState((st) => ({
    datasets: st.datasets.map((d) => {
      const col = cols.get(d.id);
      return col ? { ...d, ...appendFactorColumn(d, col) } : d;
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
  /** Set only on a replay that changed nothing because every rule that would
   *  have applied to this dataset was REFUSED (finding #4) — as opposed to
   *  genuinely having nothing to do (no rule matched anything). The pipeline
   *  runner (`components/workshops/pipeline/executeSteps.ts`) reads this to
   *  log the step "warn" instead of "ok", so the batch log points at the
   *  right step instead of reading like a clean pass. */
  refused?: boolean;
}

/** Apply `plan` to the metadata of every dataset in `ids` (their `raw` too,
 *  so a corrections re-apply keeps it). Interactively, a plan that changes
 *  nothing throws (Apply is a no-op the user should hear about); a REPLAY of
 *  it on a file that is already clean is simply done — but a replay whose
 *  rules ALL refused (finding #4) is reported as such, naming the refusal,
 *  rather than folded into the same "already clean" wording. */
export async function applyMetadataCleanup(
  s: StoreGet,
  ids: readonly string[],
  plan: CleanupPlan,
  replay = false,
): Promise<CleanupOutcome> {
  const targets = await resolveAll(s, ids);
  const result = planCleanup(targets, plan);
  const count = result.datasets.reduce((n, d) => n + d.changes.length, 0);
  const why = result.refusals.length ? `: ${result.refusals.join(" ")}` : "";
  if (!count && replay) {
    const refused = result.refusals.length > 0;
    return { result, note: refused ? `metadata cleanup refused${why}` : "metadata already clean — nothing changed", refused };
  }
  if (!count) throw new Error(why ? `nothing changed${why}` : "nothing to change");
  const at = new Date().toISOString();
  const byId = new Map(result.datasets.map((d) => [d.id, d.changes]));
  s().recordHistory("clean up metadata");
  useApp.setState((st) => ({
    datasets: st.datasets.map((d) => {
      const changes = byId.get(d.id);
      if (!changes) return d;
      const data = { ...d.data, metadata: applyCleanup(d.data.metadata, changes, at) };
      if (!d.raw) return { ...d, data };
      // `raw` gets the same outcome (a corrections re-apply derives `data`
      // from it), logged with the values RAW held, not the data side's.
      const rawMeta = d.raw.metadata;
      const rawChanges = changes.map((c) => ({ ...c, before: isScalar(rawMeta[c.key]) ? (rawMeta[c.key] as MetaScalar) : undefined }));
      return { ...d, data, raw: { ...d.raw, metadata: applyCleanup(rawMeta, rawChanges, at) } };
    }),
  }));
  for (const id of byId.keys()) s().touchDataset(id);
  record(s, { op: "metaclean", unify: plan.unify, normalize: plan.normalize }, targets);
  const refused = result.refusals.length ? ` (${result.refusals.length} refused: ${result.refusals.join(" ")})` : "";
  const note = `cleaned metadata: ${count} change${plural(count)} in ${result.datasets.length} dataset${plural(result.datasets.length)}${refused}`;
  s().setStatus(note);
  return { result, note };
}

export interface MetaStepOutcome {
  note: string;
  /** Finding #4: true only for a metaclean replay whose rules were all
   *  refused — never set for "promote" (it has no such silent-refusal case;
   *  a blocked plan throws instead). */
  refused: boolean;
}

/** Replay one recorded step on `targetId`. */
export async function runMetaStep(s: StoreGet, p: MetaStepParams, targetId: string): Promise<MetaStepOutcome> {
  if (p.op === "promote") return { note: (await promoteFactor(s, [targetId], p.path, p.as, p.name, true)).note, refused: false };
  const out = await applyMetadataCleanup(s, [targetId], { unify: p.unify, normalize: p.normalize }, true);
  return { note: out.note, refused: out.refused ?? false };
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
