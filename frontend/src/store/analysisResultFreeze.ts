// Multi-output Freeze for the result workspace (lazy; imported only by
// AnalysisResultFreeze). Every chosen output becomes an independent worksheet
// in ONE undo step. It reads the result and its linked worksheets and never
// writes them; the only state it adds is the new datasets.

import { enumerateFreezeOutputs, frozenOutputName, type FreezeOutput } from "../lib/analysisResultFreezeOutputs";
import { cloneDataStruct } from "../lib/dataset";
import type { DataStruct, Dataset } from "../lib/types";
import { nextDatasetId } from "./idSeq";
import { useApp } from "./useApp";

export interface FreezeChoice { key: string; ref: object }

/** Freeze the chosen outputs. `expected` carries the identity the user saw;
 *  any difference (result removed or edited, an output gone, its data
 *  replaced) refuses everything and creates nothing. Returns the new ids. */
export function freezeAnalysisOutputs(id: string, expected: readonly FreezeChoice[]): string[] {
  const state = useApp.getState();
  const result = state.analysisResults.find((item) => item.id === id);
  if (!result) {
    state.setStatus("can't freeze analysis result: it was deleted", "danger");
    return [];
  }
  if (!expected.length) {
    state.setStatus(`can't freeze ${result.name}: choose at least one output`, "danger");
    return [];
  }
  const live = enumerateFreezeOutputs(result, state.datasets);
  const chosen: FreezeOutput[] = [];
  for (const want of expected) {
    const now = live.find((output) => output.key === want.key);
    if (!now || now.ref !== want.ref || !now.freezable) {
      state.setStatus(`can't freeze ${result.name}: its outputs changed while choosing; choose again`, "danger");
      return [];
    }
    if (!chosen.includes(now)) chosen.push(now);
  }
  const stamp = new Date().toISOString();
  const home = state.datasets.find((dataset) => dataset.id === result.sources[0]?.datasetId);
  const frozen = chosen.map((output): Dataset => {
    const name = frozenOutputName(result, output);
    if (output.key.startsWith("ds:")) {
      const src = state.datasets.find((dataset) => dataset.id === output.key.slice(3))!;
      const data = cloneDataStruct(src.data);
      data.metadata = {
        ...data.metadata,
        frozenFrom: {
          datasetId: src.id, datasetName: src.name, resultId: result.id, resultName: result.name,
          ...(src.derivedFrom ? { sourceId: src.derivedFrom.datasetId, pipeline: src.derivedFrom.pipeline } : {}),
          frozenAt: stamp,
        },
      };
      return {
        id: nextDatasetId(), name, data,
        ...(src.notes ? { notes: src.notes } : {}),
        ...(src.tags?.length ? { tags: [...src.tags] } : {}),
        ...(src.workbookId ? { workbookId: src.workbookId } : {}),
        ...(src.folderId ? { folderId: src.folderId } : {}),
      };
    }
    const table = result.tables![Number(output.key.slice(4))];
    const data: DataStruct = {
      time: table.rows.map((_row, index) => index + 1),
      values: table.rows.map((row) => row.map((cell) => (cell === null ? Number.NaN : cell as number))),
      labels: [...table.columns], units: table.columns.map(() => ""),
      metadata: { xLabel: "Row", frozenFrom: { resultId: result.id, resultName: result.name, table: table.title ?? null, frozenAt: stamp } },
    };
    return {
      id: nextDatasetId(), name, data,
      ...(home?.workbookId ? { workbookId: home.workbookId } : {}),
      ...(home?.folderId ? { folderId: home.folderId } : {}),
    };
  });
  state.recordHistory("freeze analysis result outputs");
  useApp.setState((latest) => ({ datasets: [...latest.datasets, ...frozen] }));
  useApp.getState().setStatus(`froze ${frozen.length} output${frozen.length === 1 ? "" : "s"} of ${result.name} as independent worksheets`);
  return frozen.map((dataset) => dataset.id);
}
