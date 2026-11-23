// Live preview + commit for the Signal Processing spectrogram. The preview IS
// the full computation (the backend caps its size), so what is previewed is
// exactly what Add commits: the shared analysis commit contract
// (resultcommit/useAnalysisCommit: one undo step, idempotent, stale when the
// source changes, fail closed on a changed source).

import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { runSpectrogram } from "../../../lib/api/spectrogram";
import { tokenOf } from "../../../lib/previewKey";
import { analysisData, rowStateIdentity } from "../../../lib/rowstate";
import type { DataStruct, Dataset } from "../../../lib/types";
import { useAnalysisCommit, type AnalysisCommitState } from "../resultcommit/useAnalysisCommit";
import { useWorkbenchPreview } from "../workbench/useWorkbenchPreview";
import { spectrogramRequest, type SpectrogramRequestParams } from "./spectrogramModel";

export const SPECTROGRAM_PRODUCER = { id: "signal-spectrogram", label: "Spectrogram", version: 1 } as const;

const token = (o: unknown): number | null => (typeof o === "object" && o !== null ? tokenOf(o) : null);

export interface SpectrogramRun {
  /** The map table for the CURRENT inputs (null while a new one loads). */
  result: DataStruct | null;
  error: string;
  loading: boolean;
  commit: AnalysisCommitState;
  /** Add the previewed map as a worksheet (null when there is none yet). */
  add: () => ReturnType<AnalysisCommitState["commit"]>;
}

export function useSpectrogramRun(dataset: Dataset | null, params: SpectrogramRequestParams | string | null): SpectrogramRun {
  const ready = dataset && !dataset.pending && typeof params === "object" && params ? params : null;
  const key = !ready ? "" : JSON.stringify([dataset!.id, ...rowStateIdentity(dataset!).map(token), ready]);
  const preview = useWorkbenchPreview({
    key,
    delayMs: 220,
    run: (signal) => runSpectrogram(spectrogramRequest(analysisData(dataset!) ?? dataset!.data, ready!), signal),
  });
  const result = preview.current;
  const commit = useAnalysisCommit(ready && dataset && result ? {
    producer: SPECTROGRAM_PRODUCER,
    sourceId: dataset.id,
    computedOn: analysisDataFingerprint(dataset),
    xKey: null, // the spectrogram runs along the worksheet's own X (time axis)
    settings: { ...ready, cells: result.time.length },
    status: `added spectrogram of ${dataset.data.labels[ready.channel] ?? "the signal"}`,
    output: (source) => ({
      name: `${source.name} (spectrogram)`,
      data: result,
    }),
  } : null);
  return { result, error: preview.error, loading: preview.loading, commit, add: commit.commit };
}
