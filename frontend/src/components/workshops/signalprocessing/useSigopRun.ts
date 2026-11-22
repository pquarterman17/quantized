// Live preview + commit for one `sigop` transform on the ACTIVE dataset, shared
// by the Signal Processing filters and the Resample workshop's Reduce XY. The
// preview and the commit run the same `computeSigop` (through `runTransform`),
// so what is previewed is what is created. Preview and commit ride the shared
// workbench shell (../workbench): debounced, stale-rejecting, aborted on an
// input change or unmount; Cancel/unmount aborts a pending Create.

import { useState } from "react";

import { tokenOf } from "../../../lib/previewKey";
import { analysisData, rowStateIdentity } from "../../../lib/rowstate";
import { computeSigop, type SigopComputed, type SigopParams } from "../../../lib/transformSigop";
import type { Dataset } from "../../../lib/types";
import { createSigopFromApp } from "../../../store/sigopCommand";
import { useWorkbenchCommit } from "../workbench/useWorkbenchCommit";
import { isAbortError, useWorkbenchPreview } from "../workbench/useWorkbenchPreview";

export interface SigopRun {
  /** The preview for the CURRENT inputs (null while a new one loads). */
  result: SigopComputed | null;
  error: string;
  loading: boolean;
  busy: boolean;
  /** Create the dataset; resolves true when one was made. */
  commit: () => Promise<boolean>;
  /** Abort a pending Create (Cancel). */
  abort: () => void;
}

const token = (o: unknown): number | null => (typeof o === "object" && o !== null ? tokenOf(o) : null);

export function useSigopRun(dataset: Dataset | null, params: SigopParams | string | null): SigopRun {
  // `params` is rebuilt every render; its JSON is the stable identity. Row
  // exclusions and the Data Filter change what analysisData() reads without
  // changing `data`; the sanctioned row-state identity keeps preview == Create.
  const key = !dataset || dataset.pending || typeof params !== "object" || !params ? ""
    : JSON.stringify([dataset.id, ...rowStateIdentity(dataset).map(token), params]);
  const preview = useWorkbenchPreview({
    key,
    delayMs: 180,
    run: (signal) => computeSigop(params as SigopParams, { name: dataset!.name, data: analysisData(dataset!) ?? dataset!.data }, { signal }),
  });
  const committing = useWorkbenchCommit();
  // A commit failure belongs to the inputs it ran on: an edit clears it.
  const [commitError, setCommitError] = useState<{ key: string; message: string } | null>(null);

  const commit = async (): Promise<boolean> => {
    if (!dataset || typeof params !== "object" || !params) return false;
    const made = await committing.run(async (signal) => {
      try {
        return await createSigopFromApp(params, dataset.id, signal);
      } catch (e) {
        if (!signal.aborted && !isAbortError(e)) setCommitError({ key, message: e instanceof Error ? e.message : "Couldn't create the dataset" });
        return false;
      }
    });
    return made === true;
  };

  return {
    result: preview.current,
    error: (commitError?.key === key ? commitError.message : "") || preview.error,
    loading: preview.loading,
    busy: committing.busy,
    commit,
    abort: committing.abort,
  };
}
