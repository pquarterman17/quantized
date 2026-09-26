// Store writer for a peak table the CALLER builds (audit P2.1) — the Peak
// Analyzer's model fit (peakwizard/modelFitPublishRun.ts) publishes through it.
//
// WHY NOT store/peakTables.ts — AND WHY THE STAMP IS A TWIN. Both are bundle
// boundaries, measured 2026-09-25 against the eager entry (865,631 B):
//   * importing store/peakTables.ts from the Peak Analyzer moved it into the
//     lazy chunk the two workshops share, which renamed that chunk inside the
//     eager entry's preload map: 865,639 (+8);
//   * making `publishFitResult` delegate here instead (one stamp definition)
//     made this module shared by the Peaks chunk and the analyzer's lazy
//     publish chunk, so rollup split it into a chunk of its own: 865,673 (+42).
// So only the analyzer imports this file, and the stamp below is a deliberate
// twin of `publishFitResult`'s: the same live-dataset fields from the same
// helpers (xChannelIdentity, peakDataFingerprint, wavelengthFromMetadata). A
// change to how a table is stamped must be made in BOTH.
//
// Plain functions, not a slice — see store/peakTables.ts's header for why.

import type { PeakTable } from "../lib/peakTable";
import { peakDataFingerprint, xChannelIdentity } from "../lib/peakTableFit";
import { wavelengthFromMetadata } from "../lib/xrdWavelength";
import { useApp } from "./useApp";

/** The provenance every producer stamps from the LIVE dataset: its identity
 *  and wavelength, the x axis the fit ran on (Williamson-Hall refuses a
 *  q / d-spacing table on it) and the data digest every reader compares. */
export interface LiveStamp {
  datasetId: string;
  datasetName: string;
  wavelengthA: number | null;
  xLabel: string;
  xUnit: string;
  fingerprint: string;
}

/** Publish a table built from the LIVE dataset's stamp and its current table
 *  (whose exclusions the builder carries). `xKey` must be the channel the fit
 *  really ran on. One undo step. Returns the published table, or null for an
 *  unknown dataset (it can be removed while a fit is on screen). */
export function publishBuiltTable(
  datasetId: string,
  xKey: number | null,
  historyLabel: string,
  build: (stamp: LiveStamp, prior: PeakTable | null) => PeakTable,
): PeakTable | null {
  const ds = useApp.getState().datasets.find((d) => d.id === datasetId);
  if (!ds) return null;
  const table = build(
    {
      datasetId,
      datasetName: ds.name,
      wavelengthA: wavelengthFromMetadata(ds.data.metadata),
      ...xChannelIdentity(ds.data, xKey),
      fingerprint: peakDataFingerprint(ds),
    },
    ds.peakTable ?? null,
  );
  useApp.getState().recordHistory(historyLabel);
  useApp.setState((s) => ({
    datasets: s.datasets.map((d) => (d.id === datasetId ? { ...d, peakTable: table } : d)),
  }));
  return table;
}
