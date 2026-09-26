// Peak Analyzer — the LAZY half of "Publish to peak table" (audit P2.1),
// loaded on demand by useModelFit. It takes the draft ./modelFitPublish built
// from the fit and adds what depends on the table it joins: a fresh id per
// row, the prior table's exclusions carried by peak identity (lib/peakTableFit
// `carriedExclusions`, whichever producer wrote that table), and the provenance
// stamped from the LIVE dataset by the store writer. See ./modelFitPublish's
// header for why this is a seam, and keep its imports from the wizard TYPE-only.

import { PEAK_TABLE_VERSION, type PeakTable } from "../../../lib/peakTable";
import { carriedExclusions, nextPeakId } from "../../../lib/peakTableFit";
import { publishBuiltTable, type LiveStamp } from "../../../store/peakTablePublish";
import type { ModelFitDraft } from "./modelFitPublish";

/** The live-dataset fields (`StampedField` in ./modelFitPublish) — in a test
 *  `fingerprint` may be null ("unknown"). */
export type TableStamp = Omit<LiveStamp, "fingerprint"> & { fingerprint: string | null };

/** Draft + stamp (+ the table it replaces) -> the durable table. */
export function assembleModelFitTable(draft: ModelFitDraft, stamp: TableStamp, prior?: PeakTable | null): PeakTable {
  const excluded = carriedExclusions({ peaks: draft.rows }, prior);
  return {
    version: PEAK_TABLE_VERSION,
    peaks: draft.rows.map((row, i) => ({ id: nextPeakId(), ...row, excluded: excluded[i] })),
    provenance: {
      datasetId: stamp.datasetId,
      datasetName: stamp.datasetName,
      wavelengthA: stamp.wavelengthA,
      xLabel: stamp.xLabel,
      xUnit: stamp.xUnit,
      fingerprint: stamp.fingerprint,
      ...draft.provenance,
    },
  };
}

/** Write the draft into the dataset's durable peak table (one undo step).
 *  `xKey` is the channel the fit ran on. Returns the number of peaks
 *  published, or null for an unknown dataset. */
export function publishModelFit(datasetId: string, xKey: number | null, draft: ModelFitDraft): number | null {
  const table = publishBuiltTable(datasetId, xKey, "publish model fit", (stamp, prior) =>
    assembleModelFitTable(draft, stamp, prior));
  return table ? table.peaks.length : null;
}
