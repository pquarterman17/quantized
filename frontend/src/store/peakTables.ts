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
// NOT wrapped in `recordHistory`: a peak table is the RECORD OF A FIT, the same
// category as `Dataset.fitSpec` (useApp.ts's `setFitSpec`, also unwrapped) — it
// is produced by an explicit fit the user just ran and is replaced by the next
// one, not an edit to their data that Ctrl+Z should walk back. The exclusion
// toggle rides the same rule so a fit and the review of its peaks behave alike.

import type { MultiFitResult, PeakTable } from "../lib/peakTable";
import { peakTableFromFit, withPeakExcluded } from "../lib/peakTableFit";
import { wavelengthFromMetadata } from "../lib/xrdWavelength";
import { useApp } from "./useApp";

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
  opts: { bgDegree: number; linkMode: string; constrain: boolean },
): void {
  const ds = useApp.getState().datasets.find((d) => d.id === datasetId);
  if (!ds) return;
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
      },
      ds.peakTable ?? null,
    ),
  );
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
  publishPeakTable(datasetId, next);
}
