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
import { plural } from "../../../lib/plural";
import { normalizeRect, roiBoxBody, roiStatsBody, type BoxCutOptions, type RoiRect } from "../../../lib/roi";
import type { DataStruct } from "../../../lib/types";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { useRoisStore } from "../../../store/hooks/useRoisStore";
import { useCutLanding } from "../../Stage/useCutLanding";
import { ROI_BATCH_SUMMARY_PRODUCER, ROI_CUT_PRODUCER } from "./roiCutProducer";
import { csvBlob, csvTextCell } from "../../../lib/csvCell";
import { datasetsInputsToken } from "../workbench/inputsKey";

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
  /** Datasets not started because the user pressed Stop. A stopped batch keeps
   *  the cuts already landed (each is a complete, recorded result) and lands NO
   *  overlay figure and NO summary table: a table of only the first k rows would
   *  read as the whole selection. */
  stopped: number;
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
  if (rect.space === "map") return "the box was drawn on a plain map's own axes, not an RSM pair";
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
  const q = csvTextCell; // dataset names are file-derived: formula-neutralized (OWASP)
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
  /** Datasets finished of those that run, and the one in flight; null when idle. */
  progress: { done: number; total: number; current: string | null } | null;
  /** Stop after the dataset in flight (its request is not aborted mid-cut, so
   *  nothing half-landed). Datasets not yet started are skipped. */
  stop: () => void;
  plotTogether: boolean;
  setPlotTogether: (v: boolean) => void;
  summaryTable: boolean;
  setSummaryTable: (v: boolean) => void;
  /** Per-dataset box-stats rows from the LAST run (summaryTable only) — the
   *  batch-results card's live TabulateTable preview reads this directly. */
  summaryRows: BatchSummaryRow[];
  outcome: BatchOutcome | null;
  /** The summary rows were measured for a box, or rows / data of the datasets
   *  that ran, that have since changed (lane WB7): the card withholds the table
   *  and Export CSV. The cuts and summary dataset already landed are unaffected. */
  summaryStale: boolean;
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
  const { landCommitted } = useCutLanding();
  // A `useState` alone re-entrancy check is stale until the NEXT render —
  // two synchronous `applyToSelected()` calls (e.g. a double-click before
  // React processes the first `setBusy(true)`) would both read the same
  // pre-update closure value and both pass the guard. `busyRef` is updated
  // synchronously, in the same tick, so the second call is reliably
  // rejected regardless of render timing; `busy` (state) stays for the
  // reactive "Working…"/disabled UI.
  const busyRef = useRef(false);
  const stopRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<RoiBatchState["progress"]>(null);
  const [plotTogether, setPlotTogether] = useState(true);
  const [summaryTable, setSummaryTable] = useState(true);
  const [summaryRows, setSummaryRows] = useState<BatchSummaryRow[]>([]);
  const [outcome, setOutcome] = useState<BatchOutcome | null>(null);
  // What the summary rows were measured for: the box and the data of the
  // datasets that ran (taken after a lazy book is installed, at launch for the box).
  const [ran, setRan] = useState<{ roi: string; ids: readonly string[]; token: string } | null>(null);
  const liveRoi = JSON.stringify(useRoisStore((s) => s.mapRoi));
  const liveDatasets = useApp((s) => s.datasets);
  const summaryStale = ran !== null && summaryRows.length > 0 &&
    (ran.roi !== liveRoi || ran.token !== datasetsInputsToken(ran.ids, liveDatasets));

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
    stopRef.current = false;
    setBusy(true);
    setOutcome(null);
    setSummaryRows([]);
    setRan(null);
    const launchRoi = JSON.stringify(useApp.getState().mapRoi);
    // Hoisted out of the `try` so the outer catch can report the partial
    // outcome (how many cuts already landed, and the first failure).
    let total = ids.length;
    const errored: BatchNamedReason[] = [];
    const newIds: string[] = [];
    try {
      const normalized = normalizeRect(rect);
      const resolved = await useApp.getState().resolveDatasets(ids);
      total = resolved.length;
      const ranIds = resolved.map((d) => d.id);
      const ranToken = datasetsInputsToken(ranIds, useApp.getState().datasets);

      const skipped: BatchNamedReason[] = [];
      const statsErrored: BatchNamedReason[] = [];
      const rows: BatchSummaryRow[] = [];
      const rowSources: typeof resolved = [];

      let stopped = 0;
      for (const [index, ds] of resolved.entries()) {
        if (stopRef.current) {
          stopped = resolved.length - index;
          break;
        }
        setProgress({ done: index, total: resolved.length, current: ds.name });
        const reason = batchEligibility(ds.data, normalized);
        if (reason) {
          skipped.push({ name: ds.name, reason });
          continue;
        }

        try {
          const body = roiBoxBody(ds.data, normalized, opts) as unknown as BoxCutRequest;
          const { dataset: _rows, ...cutSettings } = body as unknown as { dataset: unknown } & Record<string, unknown>;
          const cut = await rsmBoxCut(body);
          const landed = await landCommitted(Promise.resolve(cut), { producer: ROI_CUT_PRODUCER, sources: [ds], settings: { kind: "box", ...cutSettings } }, `${ds.name}: `);
          if (!landed) errored.push({ name: ds.name, reason: "landing failed" });
          // A repeat of the same cut adds nothing: say so instead of counting it as new.
          else if (landed.kind === "existing") skipped.push({ name: ds.name, reason: "this cut is already in the Library; nothing was duplicated" });
          else newIds.push(landed.id);
        } catch (e) {
          errored.push({ name: ds.name, reason: e instanceof Error ? e.message : "cut failed" });
        }

        if (summaryTable) {
          try {
            const statsBody = roiStatsBody(ds.data, normalized) as unknown as BoxStatsRequest;
            rows.push({ name: ds.name, stats: await rsmBoxStats(statsBody) });
            rowSources.push(ds);
          } catch (e) {
            statsErrored.push({ name: ds.name, reason: e instanceof Error ? e.message : "stats failed" });
          }
        }
      }

      // A stopped batch keeps its landed cuts but builds no aggregate over
      // only part of the selection (fail closed).
      if (stopped > 0) rows.length = 0;
      setSummaryRows(rows);
      setRan({ roi: launchRoi, ids: ranIds, token: ranToken });

      // plotSelectedTogether itself requires >=2 datasets to overlay; below
      // that it would toast a confusing "select at least 2" for what is
      // really "the batch only produced one cut" — skip the call instead.
      let plottedTogether = false;
      if (stopped === 0 && plotTogether && newIds.length >= 2) {
        await plotSelectedTogether(newIds);
        plottedTogether = true;
      }

      let summaryLanded = false;
      if (stopped === 0 && summaryTable && rows.length > 0) {
        const summary = await landCommitted(Promise.resolve(buildBatchSummaryDataStruct(rows)), {
          producer: ROI_BATCH_SUMMARY_PRODUCER,
          sources: rowSources,
          settings: { kind: "summary", box: normalized },
        });
        summaryLanded = summary != null && summary.kind !== "existing";
      }

      setOutcome({ appliedCount: newIds.length, skipped, errored, statsErrored, newIds, plottedTogether, summaryLanded, stopped });

      // The one-line report names WHICH dataset and WHY (the `outcome` card
      // is gone with the panel); pattern: store/reimportAllRun.ts's summary.
      const problems = [...skipped, ...errored, ...statsErrored.map((e) => ({ ...e, reason: `stats: ${e.reason}` }))];
      const why = problems.length ? ` — ${problems.map((p) => `${p.name}: ${p.reason}`).join("; ")}` : "";
      useApp.getState().setStatus(
        `batch${stopped ? " stopped" : ""}: applied to ${newIds.length} of ${total} dataset${plural(total)}${stopped ? ` (${stopped} not started; no summary table or overlay made)` : ""}${why}`,
      );
    } catch (e) {
      // Per-dataset cut/stats failures are already caught above and reported
      // in `outcome` — this only catches something unexpected (a bug in
      // plotSelectedTogether, the summary build, etc.) so the batch never
      // leaves an unhandled rejection behind a fire-and-forget `void
      // applyToSelected(...)` call site. Cuts may already have landed by
      // then, so it reports the partial outcome, never a bare "failed"
      // (pattern: store/reimportAllRun.ts's "re-imported N — K skipped").
      const first = errored[0] ? `${errored[0].name}: ${errored[0].reason}` : e instanceof Error ? e.message : String(e);
      toast(`batch failed: ${newIds.length} of ${total} succeeded; first failure: ${first}`, "danger");
    } finally {
      busyRef.current = false;
      setBusy(false);
      setProgress(null);
    }
  }

  function exportCsv(): void {
    if (!summaryRows.length || summaryStale) return;
    saveBlob(csvBlob(summaryToCsv(summaryRows)), "roi-batch-summary.csv");
  }

  return {
    busy,
    progress,
    stop: () => {
      stopRef.current = true;
    },
    plotTogether,
    setPlotTogether,
    summaryTable,
    setSummaryTable,
    summaryRows,
    outcome,
    summaryStale,
    applyToSelected,
    exportCsv,
  };
}
