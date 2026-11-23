// Guards for a Signal Processing output (lib/transformRun.ts `runTransform`).
//
// 1. SOURCE UNCHANGED while the compute / review was open (moved out of
//    transformRun.ts to keep that module under its line ceiling).
// 2. DUPLICATE: an interactive commit of the same recipe on the same, unchanged
//    source that produced the same numbers finds the output it already made
//    (result audit row 25). Pipeline / macro replay does not use this: a replay
//    is a recorded run and always creates its output.

import { dataFingerprint } from "./dataFingerprint";
import { rowStateIdentity } from "./rowstate";
import type { SignalTransformParams } from "./signalTransform";
import type { DataStruct, Dataset } from "./types";

type Get = () => { datasets: Dataset[]; staleDatasets: string[] };

/** Snapshot the inputs now; the returned check throws if any changed since. */
export function signalSourceGuard(s: Get, p: { op: string }, inputs: readonly Dataset[], readsView: boolean): () => void {
  if (p.op !== "signal") return () => undefined;
  const snapshots = inputs.map((dataset) => ({
    id: dataset.id, data: dataset.data, rows: rowStateIdentity(dataset), errorRoles: JSON.stringify(dataset.errorRoles ?? []),
  }));
  return () => {
    const changed = snapshots.some((snapshot) => {
      const current = s().datasets.find((dataset) => dataset.id === snapshot.id);
      return !current || current.pending || current.data !== snapshot.data ||
        (readsView && rowStateIdentity(current).some((part, i) => part !== snapshot.rows[i])) ||
        JSON.stringify(current.errorRoles ?? []) !== snapshot.errorRoles;
    });
    if (changed) throw new Error("the source worksheet changed while Signal Processing was running");
  };
}

/** The current (not Out of date) output of `params` on `primary` whose numbers
 *  equal `data`, or undefined. */
export function findSignalDuplicate(
  s: Get, params: SignalTransformParams, primary: Dataset, patch: Partial<Dataset> | undefined, data: DataStruct,
): Dataset | undefined {
  const recipe = JSON.stringify(patch?.analysisRecipe ?? params.recipe);
  const fingerprint = dataFingerprint(data);
  const { datasets, staleDatasets } = s();
  return datasets.find((d) =>
    d.derivedFrom?.datasetId === primary.id && !!d.analysisRecipe && !staleDatasets.includes(d.id) &&
    JSON.stringify(d.analysisRecipe) === recipe && dataFingerprint(d.data) === fingerprint);
}
