// Reflectivity fit — the saved-fit half of the Fit view (P2.2 slice 3): the
// bound dataset's fit history, the picker over it, and the three things a
// saved fit offers — "Apply to model" (behind slice 2's stale-stack/radiation
// guard), "Restore fit setup", and "Add to report". Also the one writer that
// stores a finished fit (`publish`). The rules live in reflFitRecord.ts and
// reflFitRestore.ts; this hook only binds them to the store and the model.
//
// Store access is by selector plus `useApp.setState` — no imperative store
// snapshot reads (architecture.test.ts's getState file-count ratchet).

import { useState } from "react";

import { reportEmit } from "../../../lib/api/report";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { applyBlockedReason, applyResults, fittedGlobals, type FitGlobals } from "./reflFitModel";
import { recordDatasetIds, recordsFor, withFitRecord, type ReflFitRecord } from "./reflFitRecord";
import { recordIssues, restoreSetup, type RecordIssues, type RestoredSetup } from "./reflFitRestore";
import type { ModelLayer, Radiation } from "./useReflectivity";
import type { ReflModelHandle } from "./useReflFit";

export interface ReflFitHistory {
  /** The bound dataset's saved fits, newest first. */
  records: ReflFitRecord[];
  /** The picker's choice; null = the default (the live fit, else the newest). */
  pickedId: string | null;
  /** The saved record on show (the pick, else the newest), or null. */
  selected: ReflFitRecord | null;
  /** What the live library says about `selected`. */
  issues: RecordIssues;
  /** Why "Apply to model" is unavailable for `selected`, or null. */
  applyBlocked: string | null;
  reporting: boolean;
  pick: (id: string | null) => void;
  applySaved: () => void;
  restore: () => void;
  publish: (record: ReflFitRecord) => void;
  addToReport: (record: ReflFitRecord) => Promise<void>;
}

export interface HistoryDeps {
  /** The dataset whose history is shown (the first channel's). */
  hostId: string | null;
  datasets: Dataset[];
  model: ReflModelHandle;
  /** Load a restored setup into the Fit view. */
  loadSetup: (setup: RestoredSetup) => void;
  setGlobals: (fn: (g: FitGlobals) => FitGlobals) => void;
  setError: (message: string | null) => void;
}

const NO_ISSUES: RecordIssues = { missing: [], changed: [] };

function hostName(record: ReflFitRecord, datasets: readonly Dataset[]): string {
  const first = record.request.channels[0];
  return datasets.find((d) => d.id === first.datasetId)?.name ?? first.datasetName;
}

export function useReflFitHistory(deps: HistoryDeps): ReflFitHistory {
  const { hostId, datasets, model, loadSetup, setGlobals, setError } = deps;
  const { layers, presets, radiation, replaceLayers } = model;
  const recordHistory = useApp((s) => s.recordHistory);
  const addReport = useApp((s) => s.addReport);
  const setStatus = useApp((s) => s.setStatus);
  const host = datasets.find((d) => d.id === hostId);
  const records = recordsFor(host);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  // After a saved fit is applied, re-applying it stays allowed against the
  // stack it produced (the live fit's `basis` rule in useReflFit).
  const [appliedBasis, setAppliedBasis] = useState<{ id: string; layers: ModelLayer[]; radiation: Radiation } | null>(null);

  const selected = records.find((r) => r.id === pickedId) ?? records[0] ?? null;
  const issues = selected ? recordIssues(selected, datasets) : NO_ISSUES; // cached per channel dataset
  const basis = selected && appliedBasis?.id === selected.id ? appliedBasis : selected?.model;
  const applyBlocked = basis ? applyBlockedReason(basis, layers, radiation) : null;

  function applySaved(): void {
    if (!selected || !basis) return;
    const blocked = applyBlockedReason(basis, layers, radiation);
    if (blocked) {
      setError(`cannot apply: ${blocked}`);
      return;
    }
    const next = applyResults(layers, presets, radiation, selected.result.parameters);
    replaceLayers(next);
    setAppliedBasis({ id: selected.id, layers: next, radiation });
    setGlobals((g) => fittedGlobals(selected.result.parameters, g));
    setStatus(`applied the values of reflectivity fit #${selected.seq} to the layer model`);
  }

  function restore(): void {
    if (!selected) return;
    const setup = restoreSetup(selected, datasets, presets);
    if (typeof setup === "string") {
      setError(setup);
      return;
    }
    loadSetup(setup);
    setPickedId(selected.id);
    setAppliedBasis(null); // the stack is the fit's own snapshot again
    if (setup.skipped.length) setError(`restored without: ${setup.skipped.join("; ")}`);
    setStatus(`restored the setup of reflectivity fit #${selected.seq}`);
  }

  function publish(record: ReflFitRecord): void {
    setPickedId(null); // a new fit is the one on show
    const ids = recordDatasetIds(record);
    if (!datasets.some((d) => ids.includes(d.id))) return; // deleted mid-fit
    recordHistory("reflectivity fit");
    useApp.setState((s) => ({ datasets: withFitRecord(s.datasets, record) }));
  }

  async function addToReport(record: ReflFitRecord): Promise<void> {
    const name = hostName(record, datasets);
    const title = `Reflectivity fit #${record.seq} — ${name}`;
    setReporting(true);
    try {
      const { report } = await reportEmit({
        kind: "refl_fit",
        result: record.result as unknown as Record<string, unknown>,
        title,
        source_refs: recordDatasetIds(record).map((id) => ({
          kind: "dataset",
          id,
          name: datasets.find((d) => d.id === id)?.name ?? record.request.channels.find((c) => c.datasetId === id)?.datasetName,
        })),
      });
      addReport(title, report, record.request.channels[0].datasetId);
      setStatus(`added reflectivity fit #${record.seq} to the reports`);
    } catch (e) {
      setError(`could not add to the report — ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setReporting(false);
    }
  }

  return {
    records,
    pickedId,
    selected,
    issues,
    applyBlocked,
    reporting,
    pick: setPickedId,
    applySaved,
    restore,
    publish,
    addToReport,
  };
}
