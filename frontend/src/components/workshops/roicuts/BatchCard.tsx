// Batch card — apply the current box ROI across every selected dataset
// (RSM_CUTS_PLAN item 9). Reuses existing surfaces only: `useRoiBatch.ts`
// shapes every request through `lib/roi.ts`'s `roiBoxBody`/`roiStatsBody`
// and lands every result through `Stage/useCutLanding.ts`, the overlay
// figure is `lib/plotSelectedTogether.ts::plotSelectedTogether` (the exact
// function the Plot menu/context actions already share), and the summary
// table is rendered with `workshops/tabulate/TabulateTable.tsx` — this file
// adds no new plotting or tabulation math, only the checkboxes + results
// wiring around them.
//
// `lib/tabulate.ts` itself (the grouping ENGINE — `tabulateNested`/
// `computeStats`) is never called here (see useRoiBatch.ts's header for
// why: it groups columns WITHIN one dataset, the wrong tool for a
// cross-dataset summary). TabulateTable is reused structurally only: every
// metric below is its OWN "group" column (`levelLabel` formats the raw
// number), never a value/StatKey pair — so no invented "mean"/"sum"
// sub-header is ever shown over a number that isn't a statistic.
// `STAT_KEYS` is a required-but-unused placeholder (`valueLabels` is
// empty, so it never renders) purely to satisfy the component's "pick at
// least one stat" gate.

import { Button, Checkbox } from "../../primitives";
import Card from "../../primitives/Card";
import { fmtNum } from "../../../lib/format";
import type { StatKey, TabRow } from "../../../lib/tabulate";
import TabulateTable from "../tabulate/TabulateTable";
import type { RoiCutsState } from "./useRoiCuts";
import { useRoiBatch, type BatchNamedReason, type BatchSummaryRow } from "./useRoiBatch";

const GROUP_LABELS = ["Dataset", "∫I", "Centroid X", "Centroid Y", "Peak X", "Peak Y", "Max", "N"];
const STAT_KEYS: readonly StatKey[] = ["count"];

function toPreviewRows(rows: readonly BatchSummaryRow[]): TabRow[] {
  return rows.map((r, i) => ({
    levels: [
      i,
      r.stats.integrated_intensity,
      r.stats.centroid_x,
      r.stats.centroid_y,
      r.stats.peak_x,
      r.stats.peak_y,
      r.stats.max_intensity,
      r.stats.n_points,
    ],
    values: [],
  }));
}

function previewLevelLabel(rows: readonly BatchSummaryRow[]): (row: TabRow, depth: number) => string {
  return (row, depth) => (depth === 0 ? (rows[row.levels[0]]?.name ?? "?") : fmtNum(row.levels[depth]));
}

function ReasonList({ title, items, danger }: { title: string; items: BatchNamedReason[]; danger?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="qzk-ds-meta" style={{ marginTop: 4, color: danger ? "var(--danger)" : undefined }}>
      {title}: {items.map((i) => `${i.name} (${i.reason})`).join("; ")}
    </div>
  );
}

/** The Run button's disabled reason, or undefined when it's enabled —
 *  named per-cause (never a bare disabled boolean) so the tooltip always
 *  explains why, matching SavedRoisCard's "Draw or type a box/ruler first"
 *  precedent. */
function disabledReason(roi: RoiCutsState, batchBusy: boolean): string | undefined {
  if (!roi.isMap) return "The active dataset is not a 2-D map";
  if (!roi.boxRect) return "Draw or type a box first (Box card, above)";
  if (roi.selectedIds.length === 0) return "Select datasets in the Library first";
  if (batchBusy) return "A batch is already running";
  return undefined;
}

export default function BatchCard({ roi }: { roi: RoiCutsState }) {
  const batch = useRoiBatch();
  const reason = disabledReason(roi, batch.busy);

  return (
    <Card title="Batch across datasets">
      {!roi.boxRect && <div className="qzk-ds-meta">Draw or type a box first (Box card, above).</div>}
      <div className="qzk-ds-meta">
        {roi.selectedIds.length} dataset{roi.selectedIds.length === 1 ? "" : "s"} selected in the Library.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
        <Checkbox checked={batch.plotTogether} onChange={batch.setPlotTogether}>
          Plot results together
        </Checkbox>
        <Checkbox checked={batch.summaryTable} onChange={batch.setSummaryTable}>
          Summary table
        </Checkbox>
      </div>

      <div style={{ marginTop: 10 }}>
        <Button
          variant="primary"
          size="sm"
          disabled={!!reason}
          title={reason}
          onClick={() =>
            void batch.applyToSelected(roi.boxRect, {
              collapse: roi.boxCollapse,
              reduce: roi.boxReduce,
              nBins: roi.boxBins,
            })
          }
        >
          {batch.busy ? "Working…" : "Apply to selected"}
        </Button>
      </div>

      {batch.outcome && (
        <div style={{ marginTop: 10 }}>
          <div className="qzk-ds-meta">
            applied to {batch.outcome.appliedCount}
            {batch.outcome.skipped.length > 0 ? `, skipped ${batch.outcome.skipped.length}` : ""}
            {batch.outcome.errored.length > 0 ? `, ${batch.outcome.errored.length} failed` : ""}
            {batch.outcome.plottedTogether ? " — plotted together" : ""}
            {batch.outcome.summaryLanded ? " — summary table landed" : ""}
          </div>
          <ReasonList title="Skipped" items={batch.outcome.skipped} />
          <ReasonList title="Failed" items={batch.outcome.errored} danger />
          <ReasonList title="Stats failed" items={batch.outcome.statsErrored} danger />
        </div>
      )}

      {batch.summaryRows.length > 0 && (
        <>
          <TabulateTable
            groupLabels={GROUP_LABELS}
            valueLabels={[]}
            statKeys={STAT_KEYS}
            rows={toPreviewRows(batch.summaryRows)}
            levelLabel={previewLevelLabel(batch.summaryRows)}
          />
          <div style={{ marginTop: 8 }}>
            <Button size="sm" onClick={batch.exportCsv}>
              Export CSV
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
