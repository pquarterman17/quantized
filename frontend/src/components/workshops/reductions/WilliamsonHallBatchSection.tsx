import { useEffect, useMemo, useRef, useState } from "react";

import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { williamsonHall } from "../../../lib/api/reductions";
import {
  WILLIAMSON_HALL_BATCH_LIMIT,
  williamsonHallBatchItem,
  williamsonHallBatchResult,
  type WilliamsonHallBatchOutcome,
} from "../../../lib/williamsonHallBatch";
import { williamsonHallPeakTableFingerprint } from "../../../lib/williamsonHallRecipe";
import { registerAnalysisResult } from "../../../store/analysisResultActions";
import { nextAnalysisResultId } from "../../../store/idSeq";
import { beginOp, endOp, updateOp } from "../../../store/pendingOps";
import { analysisBatchRuntime } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { Button } from "../../primitives";
import "../analysisselection/analysisInputReview.css";

type RowStatus = "ready" | "loads on run" | "running" | "completed" | "failed" | "cancelled";
interface DisplayRow { id: string; name: string; status: RowStatus; detail: string | null }

const statusLabel = (status: RowStatus): string => status[0].toUpperCase() + status.slice(1);

function scientificWarnings(outcome: WilliamsonHallBatchOutcome, instrumentalBroadeningDeg: number): string[] {
  const warnings: string[] = [];
  if (outcome.item.rows.length === 2) warnings.push("Only two peaks were fitted; R² cannot assess model adequacy.");
  if (outcome.output.r2 < 0.8) warnings.push("R² is below 0.8; inspect phase mixing and peak choices.");
  if (outcome.output.microstrain < 0) warnings.push("Microstrain is negative.");
  if (outcome.output.grain_size_nm == null || !Number.isFinite(outcome.output.grain_size_nm)) {
    warnings.push("Crystallite size is undefined because the fitted intercept is not positive.");
  }
  const clamped = instrumentalBroadeningDeg > 0
    ? outcome.item.rows.filter((row) => row.fwhm <= instrumentalBroadeningDeg).length : 0;
  if (clamped) warnings.push(`${clamped} peak width${clamped === 1 ? " was" : "s were"} clamped by the instrument correction.`);
  return warnings;
}

export default function WilliamsonHallBatchSection({ fallbackWavelengthA, kFactor, instrumentalBroadeningDeg }: {
  fallbackWavelengthA: number;
  kFactor: number;
  instrumentalBroadeningDeg: number;
}) {
  const datasets = useApp((state) => state.datasets);
  const selectedIds = useApp((state) => state.selectedIds);
  const setStatus = useApp((state) => state.setStatus);
  const [expanded, setExpanded] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastRows, setLastRows] = useState<DisplayRow[] | null>(null);
  const runningRef = useRef(false);
  const cancelRef = useRef(false);
  const selected = useMemo(() => {
    const byId = new Map(datasets.map((dataset) => [dataset.id, dataset]));
    return [...new Set(selectedIds)].map((id) => byId.get(id)).filter((dataset) => dataset !== undefined);
  }, [datasets, selectedIds]);
  const preflight = useMemo(() => selected.map((dataset): DisplayRow => {
    if (dataset.pending) return { id: dataset.id, name: dataset.name, status: "loads on run", detail: "Full peak table will be checked before fitting." };
    const prepared = williamsonHallBatchItem(dataset, fallbackWavelengthA);
    return { id: dataset.id, name: dataset.name, status: prepared.item ? "ready" : "failed",
      detail: prepared.issue ?? prepared.warning };
  }), [fallbackWavelengthA, selected]);
  const overLimit = selected.length > WILLIAMSON_HALL_BATCH_LIMIT;
  const inputKey = `${selected.map((dataset) => dataset.id).join("\0")}|${fallbackWavelengthA}|${kFactor}|${instrumentalBroadeningDeg}`;
  const lastInputKey = useRef(inputKey);
  useEffect(() => {
    if (!running && lastInputKey.current !== inputKey) {
      lastInputKey.current = inputKey;
      setLastRows(null);
    }
  }, [inputKey, running]);
  const canRun = selected.length >= 2 && !overLimit && preflight.some((row) => row.status !== "failed") &&
    Number.isFinite(kFactor) && kFactor > 0 && Number.isFinite(instrumentalBroadeningDeg) && instrumentalBroadeningDeg >= 0;

  const run = async (): Promise<void> => {
    if (!canRun || runningRef.current) return;
    const ids = selected.map((dataset) => dataset.id);
    const rows = preflight.map((row) => ({ ...row }));
    const outcomes: WilliamsonHallBatchOutcome[] = [];
    const fingerprints = new Map<string, string>();
    const runWarnings: string[] = [];
    cancelRef.current = false;
    lastInputKey.current = inputKey;
    runningRef.current = true;
    setRunning(true); setExpanded(true); setLastRows(rows.map((row) => ({ ...row })));
    const opId = beginOp(`Williamson–Hall comparison: 0/${ids.length}`, () => { cancelRef.current = true; });
    try {
      for (let index = 0; index < ids.length; index++) {
        if (cancelRef.current) {
          for (let rest = index; rest < rows.length; rest++) {
            if (rows[rest].status !== "failed") rows[rest].status = "cancelled";
          }
          break;
        }
        if (rows[index].status === "failed") continue;
        rows[index].status = "running"; rows[index].detail = null;
        setLastRows(rows.map((row) => ({ ...row })));
        updateOp(opId, `Williamson–Hall comparison: ${index + 1}/${ids.length}`);
        try {
          const source = await analysisBatchRuntime().resolveDataset(ids[index]);
          if (!source || source.pending) throw new Error("The full worksheet could not be loaded.");
          const prepared = williamsonHallBatchItem(source, fallbackWavelengthA);
          if (!prepared.item) throw new Error(prepared.issue ?? "The fitted peaks are not usable.");
          const output = await williamsonHall({
            two_theta_deg: prepared.item.rows.map((row) => row.twoTheta),
            fwhm_deg: prepared.item.rows.map((row) => row.fwhm),
            wavelength_a: prepared.item.wavelengthA,
            k_factor: kFactor,
            instrumental_broadening_deg: instrumentalBroadeningDeg,
          });
          fingerprints.set(source.id, analysisDataFingerprint(source));
          const outcome: WilliamsonHallBatchOutcome = {
            item: prepared.item, source, output,
            warning: [prepared.warning, ...scientificWarnings({ item: prepared.item, source, output }, instrumentalBroadeningDeg)]
              .filter(Boolean).join(" ") || undefined,
          };
          outcomes.push(outcome);
          rows[index].status = "completed"; rows[index].detail = outcome.warning ?? null;
          if (outcome.warning) runWarnings.push(`${source.name}: ${outcome.warning}`);
        } catch (error) {
          rows[index].status = "failed";
          rows[index].detail = error instanceof Error ? error.message : "Williamson–Hall fit failed.";
          runWarnings.push(`${rows[index].name}: ${rows[index].detail}`);
        }
        setLastRows(rows.map((row) => ({ ...row })));
      }
      const cancelled = rows.filter((row) => row.status === "cancelled").length;
      if (cancelled) runWarnings.unshift(`Comparison cancelled: ${cancelled} worksheet${cancelled === 1 ? " was" : "s were"} not started.`);
      if (!outcomes.length) {
        setStatus("Williamson–Hall comparison did not produce a result");
        return;
      }
      const recipe = { items: outcomes.map((outcome) => outcome.item), kFactor, instrumentalBroadeningDeg };
      const sourceFingerprint = outcomes.map((outcome) => fingerprints.get(outcome.source.id)!).join(":");
      const latest = analysisBatchRuntime().datasets;
      const stale = outcomes.some((outcome) => {
        const live = latest.find((dataset) => dataset.id === outcome.source.id);
        return !live || live.pending || analysisDataFingerprint(live) !== fingerprints.get(outcome.source.id) ||
          !live.peakTable || williamsonHallPeakTableFingerprint(live.peakTable) !== outcome.item.peakTableFingerprint;
      });
      analysisBatchRuntime().recordHistory("run Williamson–Hall comparison");
      registerAnalysisResult(williamsonHallBatchResult(
        nextAnalysisResultId(), recipe, outcomes, sourceFingerprint,
        rows.map((row) => ({ datasetId: row.id, datasetName: row.name,
          status: statusLabel(row.status), warning: row.detail })),
        runWarnings, stale,
      ));
      setStatus(`compared crystallite results for ${outcomes.length} worksheet${outcomes.length === 1 ? "" : "s"}`);
    } finally {
      endOp(opId); runningRef.current = false; setRunning(false);
      setLastRows(rows.map((row) => ({ ...row })));
    }
  };

  const shown = lastRows ?? preflight;
  return <section className="qzk-analysis-batch" aria-label="Williamson–Hall comparison">
    <button type="button" className="qzk-analysis-input-review-toggle" aria-expanded={expanded}
      onClick={() => setExpanded((value) => !value)}>
      <span><strong>Compare selected worksheets</strong> · {lastRows?.length ?? selected.length} selected</span>
      <span>{expanded ? "▾" : "▸"}</span>
    </button>
    {expanded && <div className="qzk-analysis-input-review-body">
      <p className="qzk-ds-meta">Each worksheet uses its published included peaks and recorded wavelength. K = {kFactor}; instrument broadening = {instrumentalBroadeningDeg}°.</p>
      {selected.length < 2 ? <p className="qzk-ds-meta">Select at least two worksheets in the Library to compare them.</p> : <table className="qzk-analysis-batch-table">
        <thead><tr><th>Worksheet</th><th>Status</th><th>Preflight / warning</th></tr></thead>
        <tbody>{shown.map((row) => <tr key={row.id}><td>{row.name}</td><td>{statusLabel(row.status)}</td><td>{row.detail ?? "—"}</td></tr>)}</tbody>
      </table>}
      <div className="qzk-analysis-input-review-actions">
        <span>{overLimit ? `Select ${WILLIAMSON_HALL_BATCH_LIMIT} or fewer worksheets.`
          : "Invalid worksheets are skipped; Cancel stops after the current fit."}</span>
        <Button variant="primary" size="sm" disabled={!canRun || running} onClick={() => void run()}>
          {running ? "Comparing…" : "Run comparison"}
        </Button>
      </div>
    </div>}
  </section>;
}
