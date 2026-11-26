// Which transforms register for "Repeat last action", and how each re-runs.
//
// SINGLE-INPUT (signal, resample, sigop, and the clean steps dedupe, fillmissing, standardize; no second dataset): the
// same settings run on every selected dataset.
//
// MULTI-INPUT (join, merge, dataset math, average, SIMS compare / align, a
// resample onto another sheet's grid, a spectral recipe with a second source):
// the recorded second inputs are replaced by the CURRENT selection, but only
// when its shape matches: exactly one dataset for the main input plus one for
// each recorded second input. The first selected dataset is the main input
// (A of A-B, the left side of a join, the first of an append); the rest follow
// in selection order. Any other count refuses and says how many are needed.
// The recorded columns, keys and options are kept; a column the new datasets
// do not have is refused by the transform itself, before anything is created.
//
// INPUT ORDER: "Repeat last action, inputs reversed" (the Edit menu) takes the
// selection in the opposite order, so A-B can be repeated as B-A. A one-input
// transform has nothing to reverse and says so.
//
// Also single-input: spectrogram, SIMS, transpose and stack. Split registers
// its own entry from store/splitRun.ts (every split goes through it).
// lib/repeatGuards.ts refuses, BEFORE anything is created for any selected
// dataset, a replay whose recorded column does not exist on a target. Replays (a
// running pipeline) never register: they are not something the user just did.

import type { AppState } from "../store/useApp";
import type { RepeatEntry } from "./lastAction";
import { replayRefusal } from "./repeatGuards";
import { refsOf } from "./transformStepText";
import type { DatasetRef, TransformParams } from "./transformRun";

const SINGLE_OPS: ReadonlySet<string> = new Set(["signal", "resample", "sigop", "dedupe", "fillmissing", "standardize", "spectrogram", "sims", "transpose", "stack"]);
const MULTI_OPS: ReadonlySet<string> = new Set(["join", "merge", "algebra", "average", "simscompare", "simsalign"]);

type Runner = (
  s: () => AppState,
  p: TransformParams,
  primaryId: string,
  review?: undefined,
  signal?: undefined,
  options?: undefined,
  skipDuplicate?: boolean,
) => Promise<unknown>;

/** `p` with its recorded second inputs replaced by `refs` (same count). */
export function withInputs(p: TransformParams, refs: DatasetRef[]): TransformParams {
  switch (p.op) {
    case "join":
    case "algebra":
    case "resample":
      return { ...p, with: refs[0] };
    case "merge":
    case "average":
    case "simscompare":
    case "simsalign":
      return { ...p, with: refs };
    case "signal":
      if (p.recipe.kind === "spectral" && p.recipe.secondarySource) {
        const secondarySource = { ...p.recipe.secondarySource, datasetId: refs[0].id, datasetName: refs[0].name };
        return { ...p, recipe: { ...p.recipe, secondarySource } };
      }
      return p;
    default:
      return p;
  }
}

/** The repeat entry for transform `p`, or null when it cannot be repeated. */
export function repeatableTransform(
  s: () => AppState,
  p: TransformParams,
  title: string,
  run: Runner,
): RepeatEntry | null {
  const refs = refsOf(p);
  const eligible = refs.length === 0 ? SINGLE_OPS.has(p.op) : SINGLE_OPS.has(p.op) || MULTI_OPS.has(p.op);
  if (!eligible || s().pipelineRunning) return null;
  return {
    label: title,
    run: async (opts) => {
      const st = s();
      const picked = st.selectedIds.length ? st.selectedIds : st.activeId ? [st.activeId] : [];
      if (picked.length === 0) throw new Error("select a dataset first");
      if (opts?.reverse && refs.length === 0) throw new Error("it has one input, so there is nothing to reverse");
      const ids = opts?.reverse ? [...picked].reverse() : picked;
      if (refs.length === 0) {
        for (const id of ids) {
          const ds = st.datasets.find((d) => d.id === id);
          const why = ds && replayRefusal(p, ds);
          if (why) throw new Error(`${why}; nothing was created`);
        }
        // skipDuplicate: repeating on the same data with the same settings must not make a twin.
        for (const id of ids) await run(s, p, id, undefined, undefined, undefined, true);
        return;
      }
      const need = refs.length + 1;
      if (ids.length !== need) {
        throw new Error(`it combines ${need} datasets: select exactly ${need} (the first is the main input), not ${ids.length}`);
      }
      const named = ids.map((id) => ({ id, name: st.datasets.find((d) => d.id === id)?.name ?? id }));
      await run(s, withInputs(p, named.slice(1)), named[0].id, undefined, undefined, undefined, true);
    },
  };
}
