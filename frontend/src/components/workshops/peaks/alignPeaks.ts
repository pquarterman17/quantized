// Align spectra to a common peak (zero-shift correction) — the pure half and
// the commit. No React. The backend (/api/peaks/align, calc/peak_align.py)
// measures each spectrum's peak position by a parabola through the top three
// points in a window and returns the X shift that puts it on the target; here
// each shift becomes a DERIVED dataset: the source with its X column moved,
// every Y value untouched, provenance in `metadata.peakAlign`.
//
// Lifecycle (plans/RESULT_ACCEPTANCE_AUDIT.md): the source is never written;
// every output is committed through the shared contract
// (store/analysisOutputCommit.ts: linked to its source, out of date when the
// source changes, a repeat adds nothing) inside ONE undo step, in a new
// Library folder. Sibling: baseline/baselineBatch.ts's commitBaselineBatch.

import { dataFingerprint } from "../../../lib/dataFingerprint";
import type { CommitSettings } from "../../../lib/committedOutput";
import type { InputX } from "../../../lib/resultInputsRecord";
import type { Dataset, DataStruct } from "../../../lib/types";
import { commitAnalysisOutput } from "../../../store/analysisOutputCommit";
import { moveToFolderViaWorkbooks } from "../../../store/collapsedWorkbookActions";
import { asOneEditStep } from "../../../store/undoStep";
import type { AppState } from "../../../store/useApp";
import { commonFolder } from "../groupOutputs";

export const ALIGN_PRODUCER = { id: "peak-align", label: "Align to peak", version: 1 } as const;

export const alignedName = (name: string): string => `${name.replace(/\.[^.]+$/, "")} (aligned)`;

export interface AlignProvenance {
  window: [number, number];
  position: number;
  shift: number;
  target: number;
  targetMode: "first" | "typed";
  method: string;
  xLabel: string | null;
}

/** `src` with every X value moved by `shift` (`xKey` null = the time axis);
 *  Y values are shared untouched. A non-finite shift is refused. */
export function shiftXData(src: DataStruct, xKey: number | null, shift: number, prov: AlignProvenance): DataStruct {
  if (!Number.isFinite(shift)) throw new Error("the shift is not a finite number");
  const metadata = { ...src.metadata, peakAlign: prov };
  if (xKey === null) return { ...src, time: src.time.map((t) => t + shift), metadata };
  return { ...src, values: src.values.map((row) => row.map((v, i) => (i === xKey ? v + shift : v))), metadata };
}

/** One aligned output with the source it was measured on. */
export interface AlignItem {
  name: string;
  data: DataStruct;
  sourceId: string;
  /** `analysisDataFingerprint(source)` as read when the peak was measured. */
  computedOn: string;
  settings: CommitSettings;
  xKey: InputX;
}

/** Write every output inside a fresh folder as ONE undo step. Returns the ids
 *  written (input order), the folder id (null when nothing new was written, so
 *  a repeat leaves no empty folder) and one reason per refusal. */
export function commitAlignBatch(
  items: readonly AlignItem[],
  sources: readonly Dataset[],
  get: () => AppState,
): { ids: string[]; folderId: string | null; refused: string[] } {
  const refused: string[] = [];
  return asOneEditStep(get, `align ${items.length} datasets to a common peak`, () => {
    const ids: string[] = [];
    for (const item of items) {
      const outcome = commitAnalysisOutput({
        producer: ALIGN_PRODUCER,
        sourceId: item.sourceId,
        computedOn: item.computedOn,
        settings: { ...item.settings, output: dataFingerprint(item.data) },
        xKey: item.xKey,
        output: () => ({ name: item.name, data: item.data }),
        quiet: true,
      });
      if (outcome.kind === "refused") refused.push(`${item.name}: ${outcome.reason}`);
      else if (outcome.kind === "created") ids.push(outcome.outputId);
    }
    if (!ids.length) return { ids, folderId: null, refused };
    const folderId = get().createFolder(commonFolder(get(), sources), "Peak-aligned");
    moveToFolderViaWorkbooks(ids, folderId);
    return { ids, folderId, refused };
  });
}
