// Several plain datasets added by ONE gesture (a reflectivity fit's curves, its
// uncertainty bands) land as ONE undo step: without the fold every `addDataset`
// records its own history entry and Ctrl+Z peels the set apart one worksheet at
// a time (result-lifecycle criterion 11). Returns the new ids in input order.

import type { Dataset } from "../lib/types";
import { nextDatasetId } from "./idSeq";
import { asOneEditStep } from "./undoStep";
import { useApp } from "./useApp";

export function addDatasetsOneStep(label: string, items: readonly Omit<Dataset, "id">[]): string[] {
  if (!items.length) return [];
  const get = useApp.getState;
  return asOneEditStep(get, label, () =>
    items.map((item) => {
      const id = nextDatasetId();
      get().addDataset({ ...item, id });
      return id;
    }));
}
