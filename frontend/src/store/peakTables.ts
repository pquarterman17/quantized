// Store writers for the durable fitted-peak table (audit P2.1). The contract
// and every rule about its contents live in lib/peakTable.ts; this file is only
// the two-line bridge from a workshop to `Dataset.peakTable`.
//
// PLAIN FUNCTIONS, NOT A SLICE — deliberately, and this is the established
// shape for a writer that owns no state of its own: store/levelOrder.ts,
// store/relinkCommit.ts and store/recode.ts all reach the composed store the
// same way, via `useApp.setState`. A slice would be the wrong tool twice over:
// there is no new field on `AppState` to own (the table hangs off a dataset,
// which `AppState.datasets` already holds), and composing one costs three lines
// in store/useApp.ts, which sits AT its size-ratchet pin
// (architecture.test.ts's STORE_PINS) with one line of headroom.
//
// Every change to a dataset's table records one undo step: publishing a fit,
// manual value edits, removals, and include/exclude toggles (the last three
// only after proving the mutation is effective, including removal of the
// final artifact).
//
// Why all of them: history snapshots the whole `datasets` array, so ANY
// unrecorded write to a table made after a recorded one is silently rolled
// back by undoing the recorded one. With fits unrecorded, "fit → exclude →
// re-fit → undo" threw the re-fit away under an "Undo exclude" label.
// Recording every writer makes undo step back through them in order.

import type { MultiFitResult, PeakTable } from "../lib/peakTable";
import {
  peakDataFingerprint,
  peakManualEditProblem,
  peakTableFromFit,
  withPeakExcluded,
  withPeakManualEdit,
  withoutPeaks,
  xChannelIdentity,
  type PeakManualPatch,
} from "../lib/peakTableFit";
import { plural } from "../lib/plural";
import type { Dataset } from "../lib/types";
import { wavelengthFromMetadata } from "../lib/xrdWavelength";
import { askConfirm } from "./confirmDialog";
import { useApp } from "./useApp";

/** Ask before REPLACING a dataset's peak table; true when there is none to
 *  replace, `when` says this one needs no question, or the user confirms.
 *  The one replace guard both producers share: the Peak Analyzer asks for any
 *  existing table (a narrow-range fit would otherwise silently shrink a
 *  full-pattern one), and the Peaks workshop asks — before it fits — only
 *  when the table is a model fit, whose errors, shapes and reasons a Peaks
 *  re-fit would drop (a Peaks re-fit of its own table stays one click). */
export async function confirmReplacingPeakTable(
  datasetId: string,
  incoming: string,
  when: (existing: PeakTable) => boolean = () => true,
): Promise<boolean> {
  const t = useApp.getState().datasets.find((d) => d.id === datasetId)?.peakTable;
  if (!t || !when(t)) return true;
  return askConfirm(
    "Replace the peak table?",
    `This dataset already has a ${t.peaks.length}-peak table ` +
      `(${t.provenance.producer === "model_fit" ? "a Peak Analyzer model fit, with per-peak errors" : "from the Peaks workshop"}). ` +
      `Publishing replaces it with ${incoming}; exclusions carry over to matching peaks, and Undo restores the old table.`,
    "Replace",
  );
}

/** `confirmReplacingPeakTable`'s `incoming` text for `n` peaks. */
export const incomingPeaks = (n: number, what: string): string => `${what} (${n} peak${plural(n)})`;

/** The Peaks workshop's guard, asked BEFORE it fits (so a "no" costs nothing
 *  and the panel never shows a fit that is not the table): only a model-fit
 *  table triggers it. Plain `true` — no promise, so the caller need not yield
 *  a microtask — when there is nothing to ask. */
export function confirmPeaksRefit(datasetId: string, n: number): true | Promise<boolean> {
  const t = useApp.getState().datasets.find((d) => d.id === datasetId)?.peakTable;
  return t?.provenance.producer !== "model_fit" ||
    confirmReplacingPeakTable(datasetId, incomingPeaks(n, "a Peaks-workshop fit, which has no per-peak errors"));
}

/** Why a superseded publish wrote nothing. */
export const PUBLISH_SUPERSEDED = "a newer fit, reset or dataset change superseded it — publish again";

/** Attach (or replace) a dataset's peak table. A no-op for an unknown id — the
 *  dataset can be removed while a fit is in flight. */
export function publishPeakTable(datasetId: string, table: PeakTable): void {
  useApp.setState((s) => ({
    datasets: s.datasets.map((d) => (d.id === datasetId ? { ...d, peakTable: table } : d)),
  }));
}

/** Turn a just-finished fit into this dataset's durable peak table.
 *
 *  Reads the dataset from the LIVE store rather than taking one: the caller's
 *  copy was captured before the fit's network round trip, and the exclusions
 *  this must carry over (`peakTableFromFit`'s third argument) are the ones the
 *  user has now. A no-op for an unknown id, same as `publishPeakTable`. */
export function publishFitResult(
  datasetId: string,
  result: MultiFitResult,
  method: "simultaneous" | "independent",
  opts: { bgDegree: number; linkMode: string; constrain: boolean; xKey: number | null },
): void {
  const ds = useApp.getState().datasets.find((d) => d.id === datasetId);
  if (!ds) return;
  useApp.getState().recordHistory("fit peaks");
  publishPeakTable(
    datasetId,
    peakTableFromFit(
      result,
      {
        datasetId,
        datasetName: ds.name,
        method,
        bgDegree: opts.bgDegree,
        linkMode: opts.linkMode,
        constrain: opts.constrain,
        wavelengthA: wavelengthFromMetadata(ds.data.metadata),
        // Review round 2: both halves of "does this table still describe the
        // live data" are stamped HERE, from the same live `ds` the exclusions
        // are read from — the x axis the fit ran on (so Williamson-Hall can
        // refuse a q/d-spacing table) and a digest of the data itself (so
        // every reader can tell a stale fit from a current one). Round 3: the
        // digest is taken from the DATASET, so `peakDataFingerprint` hashes
        // the analysis view the fit actually ran on, and `opts.xKey` is the
        // channel `peakInputs` really used — not the plotted one it may have
        // fallen back from (lib/fitselection's `selectedFitData` returns null
        // when no y channel is effective, and the fit then runs on `time`).
        ...xChannelIdentity(ds.data, opts.xKey),
        fingerprint: peakDataFingerprint(ds),
      },
      ds.peakTable ?? null,
    ),
  );
}

/** Publish a table another workshop BUILT — the Peak Analyzer's model fit
 *  (peakwizard/modelFitPeakTable.ts). `fitDataset` is the record the fit RAN
 *  on: records are immutable, so it IS the fit-time data, and its fingerprint
 *  (the one hash every publish pays) is what the table is stamped with. The
 *  record, not a fingerprint plus a few references, because the digest's
 *  inputs include the row filter's validity, which reads channel modelling
 *  types — the whole record is the one complete input (held by reference).
 *
 *  Resolves the dataset first (never a still-pending preview), then refuses
 *  when its analysis view is no longer what the fit ran on — publishing a
 *  table every reader would reject as stale helps nobody. When the live record
 *  IS the fit-time record, nothing can have changed and the second hash is
 *  skipped. `stillCurrent` is re-checked AFTER the await and BEFORE anything
 *  is built or written, so a re-fit, reset or dataset switch during the
 *  resolve cancels the write instead of publishing the old fit. `build` gets
 *  the LIVE record (the user's current exclusions carry over) and runs before
 *  the undo step is recorded, so a builder that throws leaves no history
 *  entry. One undo step. Returns the table written, or why nothing was. */
export async function publishBuiltPeakTable(
  fitDataset: Dataset,
  build: (ds: Dataset, fingerprint: string) => PeakTable,
  stillCurrent: () => boolean = () => true,
): Promise<{ table: PeakTable } | { reason: string }> {
  await useApp.getState().resolveDataset(fitDataset.id);
  const ds = useApp.getState().datasets.find((d) => d.id === fitDataset.id);
  if (!ds) return { reason: "the dataset is no longer available" };
  const fingerprint = peakDataFingerprint(fitDataset);
  if (ds.pending || fitDataset.pending || (ds !== fitDataset && peakDataFingerprint(ds) !== fingerprint)) {
    return { reason: "the dataset's data changed since this fit (or only a preview had loaded) — re-fit, then publish" };
  }
  if (!stillCurrent()) return { reason: PUBLISH_SUPERSEDED };
  const table = build(ds, fingerprint);
  useApp.getState().recordHistory("publish model fit to peak table");
  publishPeakTable(ds.id, table);
  return { table };
}

/** Flip one peak's `excluded` flag, addressed by its durable id.
 *
 *  A no-op — and, importantly, ZERO store write — when the dataset has no
 *  table or the id matches nothing in it: `withPeakExcluded` returns the same
 *  reference in that case, and an unchanged reference here would otherwise
 *  publish a new `datasets` array and re-render every subscriber for nothing. */
export function setPeakExcluded(datasetId: string, peakId: string, excluded: boolean): void {
  const ds = useApp.getState().datasets.find((d) => d.id === datasetId);
  if (!ds?.peakTable) return;
  const next = withPeakExcluded(ds.peakTable, peakId, excluded);
  if (next === ds.peakTable) return;
  useApp.getState().recordHistory(excluded ? "exclude fitted peak" : "include fitted peak");
  publishPeakTable(datasetId, next);
}


export function editPeak(datasetId: string, peakId: string, patch: PeakManualPatch): PeakTable | null {
  const ds = useApp.getState().datasets.find((d) => d.id === datasetId);
  if (!ds?.peakTable) return null;
  const current = ds.peakTable.peaks.find((p) => p.id === peakId);
  if (!current || peakManualEditProblem(patch, current)) return ds.peakTable;
  const next = withPeakManualEdit(ds.peakTable, peakId, patch);
  if (next === ds.peakTable) return ds.peakTable;
  useApp.getState().recordHistory("edit fitted peak");
  publishPeakTable(datasetId, next);
  return next;
}

export function removePeaks(datasetId: string, peakIds: ReadonlySet<string>): PeakTable | null {
  const ds = useApp.getState().datasets.find((d) => d.id === datasetId);
  if (!ds?.peakTable) return null;
  const next = withoutPeaks(ds.peakTable, peakIds);
  if (next === ds.peakTable) return ds.peakTable;
  useApp.getState().recordHistory("remove fitted peaks");
  useApp.setState((s) => ({
    datasets: s.datasets.map((d) =>
      d.id === datasetId ? { ...d, peakTable: next ?? undefined } : d
    ),
  }));
  return next;
}
