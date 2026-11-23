// Several plain datasets added by ONE gesture (a reflectivity fit's curves, its
// uncertainty bands) land as ONE undo step: without the fold every `addDataset`
// records its own history entry and Ctrl+Z peels the set apart one worksheet at
// a time (result-lifecycle criterion 11). Returns the new ids in input order.
// `alongside` runs inside the same step with the new ids (the reflectivity
// curves' one multi-output result, reflectivity/reflFitOutputsCommit.ts), so
// Undo removes it with the worksheets. It gets the store (`api`) so a component
// module need not reach for `useApp.getState()` itself (architecture.test.ts
// caps the files under components/ that do).

import type { Dataset } from "../lib/types";
import { nextDatasetId } from "./idSeq";
import { asOneEditStep } from "./undoStep";
import { useApp, type AppState } from "./useApp";

/** What `alongside` may read and write: the live store. */
export interface OneStepApi {
  get: () => AppState;
  set: typeof useApp.setState;
}

export function addDatasetsOneStep(
  label: string,
  items: readonly Omit<Dataset, "id">[],
  alongside?: (ids: readonly string[], api: OneStepApi) => void,
): string[] {
  if (!items.length) return [];
  const get = useApp.getState;
  return asOneEditStep(get, label, () => {
    const ids = items.map((item) => {
      const id = nextDatasetId();
      get().addDataset({ ...item, id });
      return id;
    });
    alongside?.(ids, { get, set: useApp.setState });
    return ids;
  });
}
