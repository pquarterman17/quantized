// Baseline workshop — batch helpers. "Apply to N selected" runs the SAME method +
// params on every selected dataset; the estimates are computed first (async, no
// store writes), then every output lands in ONE synchronous edit step so a
// single Ctrl+Z removes the whole batch. Outputs are grouped in a new Library
// folder (the existing folder tree; no new grouping mechanism) so an "Overlay
// these" chip can plot them together.

import { groupOutputsInFolder } from "../groupOutputs";
import type { Dataset, DataStruct } from "../../../lib/types";
import { nextDatasetId, type AppState } from "../../../store/useApp";

export interface BaselineSource {
  xKey: number | null;
  xLabel: string;
  yKey: number;
  yLabel: string;
}

/** `src` with `baseline` subtracted from channel `source.yKey` (non-finite
 *  samples and null baseline points are left untouched). */
export function subtractBaselineData(
  src: DataStruct,
  baseline: readonly (number | null)[],
  source: BaselineSource,
  method: string,
): DataStruct {
  const yKey = source.yKey;
  const values = src.values.map((row, i) => {
    const b = baseline[i];
    const next = [...row];
    if (Number.isFinite(row[yKey]) && b != null) next[yKey] = row[yKey] - b;
    return next;
  });
  return {
    ...src,
    values,
    metadata: {
      ...src.metadata,
      baseline_subtracted: method,
      baseline_source: {
        x_key: source.xKey,
        x_label: source.xLabel,
        y_key: source.yKey,
        y_label: source.yLabel,
      },
    },
  };
}

export const bgSubName = (name: string): string => `${name.replace(/\.[^.]+$/, "")} (bg-sub)`;

/** Write every output as a new dataset inside a fresh folder, as ONE undo
 *  step. Returns the new dataset ids (in input order) and the folder id. */
export function commitBaselineBatch(
  outputs: readonly { name: string; data: DataStruct }[],
  sources: readonly Dataset[],
  method: string,
  get: () => AppState,
): { ids: string[]; folderId: string } {
  return groupOutputsInFolder(get, {
    label: `baseline ${method} on ${outputs.length} datasets`,
    folderName: `Baseline-subtracted (${method})`,
    sources,
    make: () => {
      const ids = outputs.map(() => nextDatasetId());
      outputs.forEach((o, i) => get().addDataset({ id: ids[i], name: o.name, data: o.data }));
      return ids;
    },
  });
}
