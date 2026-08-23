// Batch across datasets — cuts + overlay figure + summary table
// (RSM_CUTS_PLAN item 9). Deliberately a SEPARATE hook from useRoiCuts.ts:
// that hook is already 476 lines and unguarded by any size ratchet (booked
// as item 20) — this orchestration lives in its own focused module rather
// than appending to it (size-ratchet-every-language's "no god scripts —
// new code goes in a new module").
//
// Reuses every existing surface rather than inventing a batch-specific
// path: the SAME `store.mapRoi` box + the Box card's own collapse/reduce/
// bins settings (the caller, BatchCard.tsx, passes them in via `RoiCutsState`
// — this hook owns no box-shape UI state of its own, so there is no second
// numeric-entry surface to keep in sync with the Box card's), `lib/roi.ts`'s
// `roiBoxBody`/`roiStatsBody` for request shaping (never an inline body),
// `Stage/useCutLanding.ts`'s `land` for the ONE addDataset/setStatus/error
// path (every landed cut AND the summary-table dataset go through it — no
// second landing implementation), and `lib/plotSelectedTogether.ts` for the
// overlay figure (the exact function the Plot menu/context actions already
// share — zero new plotting code).
//
// FLOOR (owner answer 3 — always on, regardless of either checkbox): the
// cuts land in the library. "Plot together" and "Summary table" are purely
// additive post-processing over the SAME landed cut ids / per-dataset
// stats — turning both off still yields N cuts (see `applyToSelected`: the
// cut request + land() call are unconditional; only the plot/stats/summary
// steps are gated).

import { useRef, useState } from "react";

import { rsmBoxCut, rsmBoxStats, type BoxCutRequest, type BoxStats, type BoxStatsRequest } from "../../../lib/api/rsm";
import { saveBlob } from "../../../lib/download";
import { is2DMap } from "../../../lib/mapdata";
import { hasQSpace } from "../../../lib/mapdataFetch";
import { plotSelectedTogether } from "../../../lib/plotSelectedTogether";
import { normalizeRect, roiBoxBody, roiStatsBody, type BoxCutOptions, type RoiRect } from "../../../lib/roi";
import type { DataStruct } from "../../../lib/types";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { useCutLanding } from "../../Stage/useCutLanding";

/** A dataset that did NOT contribute a result, and why — every skip/error
 *  names its dataset (RSM_CUTS_PLAN item 9: "a silent skip is the failure
 *  mode the repo's rules keep flagging"), never just a count. */
export interface BatchNamedReason {
  name: string;
  reason: string;
}

export interface BatchSummaryRow {
  name: string;
  stats: BoxStats;
}

export interface BatchOutcome {
  appliedCount: number;
  skipped: BatchNamedReason[];
  errored: BatchNamedReason[];
  statsErrored: BatchNamedReason[];
  newIds: string[];
  plottedTogether: boolean;
  summaryLanded: boolean;
}

/** Why `ds` can't take this box ROI, or null when eligible: not a 2-D map,
 *  or the ROI's axis space isn't available on this dataset (Resolved
 *  decisions: "ROI keeps the space it was drawn in — no silent angular<->Q
 *  conversion; batch skips space-ineligible datasets"). "angular" is always
 *  available on any `is2DMap` dataset (its two axis columns are labels[0]/
 *  labels[1] — see `lib/roi.ts::defaultRectFor`'s identical assumption);
 *  only the "q" branch needs the extra Qx/Qz check. Exported for direct
 *  unit testing. */
export function batchEligibility(ds: DataStruct, rect: RoiRect): string | null {
  if (!is2DMap(ds)) return "not a 2-D map";
  if (rect.space === "q" && !hasQSpace(ds.labels)) {
    return "ROI was drawn in Q space; this dataset has no Qx/Qz columns";
  }
  return null;
}

/** The cross-dataset summary — its OWN `DataStruct` (data-contract rule:
 *  every producer returns through the canonical struct, never an ad-hoc
 *  table), one row per dataset, landed in the library like any other
 *  dataset so it gets plotting/export/re-tabulation for free. Dataset names
 *  are carried the SAME way `lib/barlayout.ts` already resolves text labels
 *  for a numeric column (`textLabelsFor`/`resolveCategoryLabels`): the
 *  row-index "Dataset" x-column (`time`, per `useTabulate.ts`'s own
 *  `exportDataset` precedent — index -1 is the x column) pairs with a
 *  `metadata.origin_text_columns` entry naming each row's dataset — not a
 *  new convention, the existing structural one (per-row text array keyed
 *  by row index) applied to a column whose levels happen to be unique per
 *  row instead of repeating. */
export function buildBatchSummaryDataStruct(rows: readonly BatchSummaryRow[]): DataStruct {
  const names = rows.map((r) => r.name);
  return {
    time: rows.map((_, i) => i),
    values: rows.map((r) => [
      r.stats.integrated_intensity,
      r.stats.centroid_x,
      r.stats.centroid_y,
      r.stats.peak_x,
      r.stats.peak_y,
      r.stats.max_intensity,
      r.stats.n_points,
    ]),
    labels: ["Integrated Intensity", "Centroid X", "Centroid Y", "Peak X", "Peak Y", "Max Intensity", "N points"],
    units: ["", "", "", "", "", "", ""],
    metadata: {
      cut_label: `ROI batch summary (${rows.length} dataset${rows.length === 1 ? "" : "s"})`,
      source: "roi-batch-summary",
      x_column_name: "Dataset",
      origin_text_columns: { Dataset: names },
    },
  };
}

/** CSV for the "Export CSV" button — same column order as
 *  `buildBatchSummaryDataStruct`, dataset name first (RFC 4180 minimal
 *  quoting: only when a name holds a comma/quote/newline). Built directly
 *  from `rows`, independent of whether the summary dataset was landed, so
 *  the button works even if `land()` somehow failed for the summary row. */
export function summaryToCsv(rows: readonly BatchSummaryRow[]): string {
  const header = [
    "dataset",
    "integrated_intensity",
    "centroid_x",
    "centroid_y",
    "peak_x",
    "peak_y",
    "max_intensity",
    "n_points",
  ];
  const q = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = rows.map((r) =>
    [
      q(r.name),
      r.stats.integrated_intensity,
      r.stats.centroid_x,
      r.stats.centroid_y,
      r.stats.peak_x,
      r.stats.peak_y,
      r.stats.max_intensity,
      r.stats.n_points,
    ].join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export interface RoiBatchState {
  busy: boolean;
  plotTogether: boolean;
  setPlotTogether: (v: boolean) => void;
  summaryTable: boolean;
  setSummaryTable: (v: boolean) => void;
  /** Per-dataset box-stats rows from the LAST run (summaryTable only) — the
   *  batch-results card's live TabulateTable preview reads this directly. */
  summaryRows: BatchSummaryRow[];
  outcome: BatchOutcome | null;
  /** Apply `rect` (already-drawn/typed box ROI; the SAME `store.mapRoi` the
   *  Box card edits) to every dataset in `store.selectedIds`, sequentially
   *  — not a parallel flood, the backend is a local single process and each
   *  call carries a full dataset payload. `opts` is the Box card's current
   *  collapse/reduce/nBins so a batch run repeats EXACTLY the cut the user
   *  already configured for the active dataset. A no-op while a previous
   *  batch is still running. */
  applyToSelected: (rect: RoiRect | null, opts?: BoxCutOptions) => Promise<void>;
  exportCsv: () => void;
}

export function useRoiBatch(): RoiBatchState {
  const { land } = useCutLanding();
  // A `useState` alone re-entrancy check is stale until the NEXT render —
  // two synchronous `applyToSelected()` calls (e.g. a double-click before
  // React processes the first `setBusy(true)`) would both read the same
  // pre-update closure value and both pass the guard. `busyRef` is updated
  // synchronously, in the same tick, so the second call is reliably
  // rejected regardless of render timing; `busy` (state) stays for the
  // reactive "Working…"/disabled UI.
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [plotTogether, setPlotTogether] = useState(true);
  const [summaryTable, setSummaryTable] = useState(true);
  const [summaryRows, setSummaryRows] = useState<BatchSummaryRow[]>([]);
  const [outcome, setOutcome] = useState<BatchOutcome | null>(null);

  async function applyToSelected(rect: RoiRect | null, opts: BoxCutOptions = {}): Promise<void> {
    if (busyRef.current) return; // one batch at a time — the panel must not allow a second while one runs
    if (!rect) {
      toast("draw or type a box first", "danger");
      return;
    }
    const ids = useApp.getState().selectedIds;
    if (ids.length === 0) {
      toast("select datasets in the Library first", "danger");
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setOutcome(null);
    setSummaryRows([]);
    try {
      const normalized = normalizeRect(rect);
      const resolved = await useApp.getState().resolveDatasets(ids);

      const skipped: BatchNamedReason[] = [];
      const errored: BatchNamedReason[] = [];
      const statsErrored: BatchNamedReason[] = [];
      const newIds: string[] = [];
      const rows: BatchSummaryRow[] = [];

      for (const ds of resolved) {
        const reason = batchEligibility(ds.data, normalized);
        if (reason) {
          skipped.push({ name: ds.name, reason });
          continue;
        }

        try {
          const body = roiBoxBody(ds.data, normalized, opts) as unknown as BoxCutRequest;
          const cut = await rsmBoxCut(body);
          const id = await land(Promise.resolve(cut), `${ds.name}: `);
          if (id) newIds.push(id);
          else errored.push({ name: ds.name, reason: "landing failed" });
        } catch (e) {
          errored.push({ name: ds.name, reason: e instanceof Error ? e.message : "cut failed" });
        }

        if (summaryTable) {
          try {
            const statsBody = roiStatsBody(ds.data, normalized) as unknown as BoxStatsRequest;
            rows.push({ name: ds.name, stats: await rsmBoxStats(statsBody) });
          } catch (e) {
            statsErrored.push({ name: ds.name, reason: e instanceof Error ? e.message : "stats failed" });
          }
        }
      }

      setSummaryRows(rows);

      // plotSelectedTogether itself requires >=2 datasets to overlay; below
      // that it would toast a confusing "select at least 2" for what is
      // really "the batch only produced one cut" — skip the call instead.
      let plottedTogether = false;
      if (plotTogether && newIds.length >= 2) {
        await plotSelectedTogether(newIds);
        plottedTogether = true;
      }

      let summaryLanded = false;
      if (summaryTable && rows.length > 0) {
        const summaryId = await land(Promise.resolve(buildBatchSummaryDataStruct(rows)));
        summaryLanded = summaryId != null;
      }

      setOutcome({ appliedCount: newIds.length, skipped, errored, statsErrored, newIds, plottedTogether, summaryLanded });

      const skipNote = skipped.length ? `, skipped ${skipped.length}` : "";
      const errorNote = errored.length ? `, ${errored.length} failed` : "";
      useApp.getState().setStatus(`batch: applied to ${newIds.length}${skipNote}${errorNote}`);
    } catch (e) {
      // Per-dataset cut/stats failures are already caught above and reported
      // in `outcome` — this only catches something unexpected (a bug in
      // plotSelectedTogether, the summary build, etc.) so the batch never
      // leaves an unhandled rejection behind a fire-and-forget `void
      // applyToSelected(...)` call site.
      toast(e instanceof Error ? `batch failed: ${e.message}` : "batch failed", "danger");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function exportCsv(): void {
    if (!summaryRows.length) return;
    saveBlob(new Blob([summaryToCsv(summaryRows)], { type: "text/csv" }), "roi-batch-summary.csv");
  }

  return {
    busy,
    plotTogether,
    setPlotTogether,
    summaryTable,
    setSummaryTable,
    summaryRows,
    outcome,
    applyToSelected,
    exportCsv,
  };
}
