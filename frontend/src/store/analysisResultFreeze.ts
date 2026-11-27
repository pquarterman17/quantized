// Multi-output Freeze for the result workspace (lazy; imported only by
// AnalysisResultFreeze). Every chosen output becomes an independent worksheet
// in ONE undo step. It reads the result and its linked worksheets and never
// writes them; the only state it adds is the new datasets.

import { enumerateFreezeOutputs, frozenOutputName, tableToDataStruct, type FreezeOutput } from "../lib/analysisResultFreezeOutputs";
import { cloneDataStruct } from "../lib/dataset";
import { frozenTableTwin, stampResultRowRange } from "../lib/frozenTableTwin";
import type { Dataset } from "../lib/types";
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
  // A table already frozen (and still there) is returned, not frozen again: "already added", nothing duplicated.
  const twins = new Map<FreezeOutput, Dataset>();
  for (const output of chosen) {
    const twin = output.key.startsWith("tbl:") ? frozenTableTwin(result, result.tables![Number(output.key.slice(4))], state.datasets) : undefined;
    if (twin) twins.set(output, twin);
  }
  if (twins.size === chosen.length) {
    const names = chosen.map((output) => `“${twins.get(output)!.name}”`).join(", ");
    state.setStatus(`${chosen.length === 1 ? "this output is" : "these outputs are"} already added as ${names}; nothing was duplicated`);
    return chosen.map((output) => twins.get(output)!.id);
  }
  const fresh = chosen.filter((output) => !twins.has(output));
  const stamp = new Date().toISOString();
  const home = state.datasets.find((dataset) => dataset.id === result.sources[0]?.datasetId);
  const frozen = fresh.map((output): Dataset => {
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
    const data = stampResultRowRange(result, tableToDataStruct(table, { frozenFrom: { resultId: result.id, resultName: result.name, table: table.title ?? null, frozenAt: stamp } }));
    return {
      id: nextDatasetId(), name, data,
      ...(home?.workbookId ? { workbookId: home.workbookId } : {}),
      ...(home?.folderId ? { folderId: home.folderId } : {}),
    };
  });
  state.recordHistory("freeze analysis result outputs");
  useApp.setState((latest) => ({ datasets: [...latest.datasets, ...frozen] }));
  useApp.getState().setStatus(`froze ${frozen.length} output${frozen.length === 1 ? "" : "s"} of ${result.name} as independent worksheets${twins.size ? ` (${twins.size} already added)` : ""}`);
  const made = new Map(fresh.map((output, i) => [output, frozen[i].id]));
  return chosen.map((output) => made.get(output) ?? twins.get(output)!.id);
}
