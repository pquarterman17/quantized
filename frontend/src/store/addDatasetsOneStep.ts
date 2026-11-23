// Several plain datasets added by ONE gesture (a reflectivity fit's curves, its
// uncertainty bands) land as ONE undo step: without the fold every `addDataset`
// records its own history entry and Ctrl+Z peels the set apart one worksheet at
// a time (result-lifecycle criterion 11). Returns the new ids in input order.
// `alongside` runs inside the same step with the new ids (the reflectivity
// curves' one multi-output result, reflectivity/reflFitOutputsCommit.ts), so
// Undo removes it with the worksheets.

import type { Dataset } from "../lib/types";
import { nextDatasetId } from "./idSeq";
import { asOneEditStep } from "./undoStep";
import { useApp } from "./useApp";

export function addDatasetsOneStep(
  label: string,
  items: readonly Omit<Dataset, "id">[],
  alongside?: (ids: readonly string[]) => void,
): string[] {
  if (!items.length) return [];
  const get = useApp.getState;
  return asOneEditStep(get, label, () => {
    const ids = items.map((item) => {
      const id = nextDatasetId();
      get().addDataset({ ...item, id });
      return id;
    });
    alongside?.(ids);
    return ids;
  });
}
