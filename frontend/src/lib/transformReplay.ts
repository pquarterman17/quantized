// Pipeline replay of recorded `transform` steps (audit P2.5), split out of
// lib/transformRun.ts. Two reference problems a naive replay gets silently
// wrong, both from PR #431's review:
//
//  1. A recorded PRIMARY input that was not the active dataset (Dataset Math
//     with A not active, "Merge selected" whose first pick was not active)
//     must not be replaced by the run's target — computing X−Z where Y−Z was
//     recorded. `inputIsTarget` (lib/transformRun.recordedProvenance) says
//     which; otherwise the recorded input is an explicit reference.
//  2. A reference to a dataset an EARLIER step of the same pipeline created
//     ("Split A", then "A(1) − A(2)") must follow that step's REPLAY output —
//     batch-running on B has to subtract B's children, not A's. `ReplayMap`
//     tracks recorded-output id -> replay-output id, matched by output key
//     (a split child's group label). A reference to an earlier output that
//     has no replay counterpart (the step failed, was disabled, or a group
//     is missing) FAILS the step — never falls back to the recorded dataset.
//
// Steps recorded before `inputIsTarget`/`outputs` existed (this branch only)
// replay as before: primary = target, no output mapping.

import type { AppState } from "../store/useApp";
import { runTransform, transformParamsOf, type TransformOutcome } from "./transformRun";

type StoreGet = () => AppState;

/** Recorded output id -> replay output id, or null = created by an earlier
 *  step but not reproduced by this run. Ids absent from the map are ordinary
 *  workspace datasets. */
export type ReplayMap = Map<string, string | null>;

interface RecordedOutput {
  id: string;
  key: string;
}

function recordedOutputs(params: Record<string, unknown>): RecordedOutput[] {
  const raw = params.outputs;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((o) => {
    const r = (o ?? {}) as Record<string, unknown>;
    return typeof r.id === "string" ? [{ id: r.id, key: typeof r.key === "string" ? r.key : "" }] : [];
  });
}

/** Mark a step's recorded outputs as "not reproduced" (it failed, was
 *  disabled, or was skipped) so later references to them fail loudly. */
export function markNotReproduced(map: ReplayMap, params: Record<string, unknown>): void {
  for (const o of recordedOutputs(params)) map.set(o.id, null);
}

/** Rewrite one recorded reference through the map; throws when it points at
 *  an earlier step's output this run did not reproduce. */
function mapRef(map: ReplayMap, ref: unknown): unknown {
  const r = (ref ?? {}) as Record<string, unknown>;
  if (typeof r.id !== "string" || !map.has(r.id)) return ref;
  const to = map.get(r.id);
  if (!to) {
    const name = typeof r.name === "string" ? r.name : r.id;
    throw new Error(`"${name}" was created by an earlier step that did not produce it in this run`);
  }
  return { ...r, id: to };
}

/** The dataset a recorded transform acts on, and its params with every
 *  reference rewritten. Exported for tests. */
export function resolveRecorded(
  params: Record<string, unknown>,
  map: ReplayMap,
  target: string,
): { primaryId: string; params: Record<string, unknown> } {
  const out: Record<string, unknown> = { ...params };
  if (Array.isArray(params.with)) out.with = params.with.map((r) => mapRef(map, r));
  else if (params.with !== undefined) out.with = mapRef(map, params.with);
  let primaryId = target;
  if (params.inputIsTarget === false) {
    const input = mapRef(map, params.input) as { id?: unknown } | undefined;
    if (typeof input?.id !== "string") throw new Error("the step's recorded input is missing");
    primaryId = input.id;
  }
  return { primaryId, params: out };
}

/** Replay one recorded `transform` step (no review — warnings are stamped
 *  and returned for the run log) and record its outputs in `map`. */
export async function replayTransform(
  s: StoreGet,
  params: Record<string, unknown>,
  target: string,
  map: ReplayMap = new Map(),
): Promise<TransformOutcome> {
  let out: TransformOutcome | null;
  try {
    const r = resolveRecorded(params, map, target);
    if (params.inputIsTarget === false && !s().datasets.some((d) => d.id === r.primaryId)) {
      const name = String((params.input as { name?: unknown } | undefined)?.name ?? r.primaryId);
      throw new Error(`the recorded input "${name}" is not in this workspace`);
    }
    out = await runTransform(s, transformParamsOf(r.params), r.primaryId);
    if (!out) throw new Error("transform produced no output");
  } catch (e) {
    markNotReproduced(map, params);
    throw e;
  }
  for (const rec of recordedOutputs(params)) {
    map.set(rec.id, out.outputs.find((o) => o.key === rec.key)?.id ?? null);
  }
  return out;
}
