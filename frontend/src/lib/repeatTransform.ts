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
// Joins of nothing, splits and reshapes that change shape without a second
// input never register. Replays (a running pipeline) never register: they are
// not something the user just did.

import type { AppState } from "../store/useApp";
import type { RepeatEntry } from "./lastAction";
import { refsOf } from "./transformStepText";
import type { DatasetRef, TransformParams } from "./transformRun";

const SINGLE_OPS: ReadonlySet<string> = new Set(["signal", "resample", "sigop", "dedupe", "fillmissing", "standardize"]);
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
    run: async () => {
      const st = s();
      const ids = st.selectedIds.length ? st.selectedIds : st.activeId ? [st.activeId] : [];
      if (ids.length === 0) throw new Error("select a dataset first");
      if (refs.length === 0) {
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
