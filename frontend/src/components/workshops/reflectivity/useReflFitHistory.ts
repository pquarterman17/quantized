// Reflectivity fit — the saved-fit half of the Fit view (P2.2 slice 3): the
// bound dataset's fit history, the picker over it, and the three things a
// saved fit offers — "Apply to model" (behind slice 2's stale-stack/radiation
// guard), "Restore fit setup", and "Add to report". Also the one writer that
// stores a finished fit (`publish`). The rules live in reflFitRecord.ts and
// reflFitRestore.ts; this hook only binds them to the store and the model.
//
// Store access is by selector plus `useApp.setState` — no imperative store
// snapshot reads (architecture.test.ts's getState file-count ratchet).

import { useEffect, useRef, useState } from "react";

import { reportEmit } from "../../../lib/api/report";
import type { Dataset } from "../../../lib/types";
import { nextDatasetId, useApp } from "../../../store/useApp";
import { curveDatasets, savedOverlay } from "./reflFitCurves";
import { applyBlockedReason, applyResults, fittedGlobals, type FitGlobals } from "./reflFitModel";
import { nextSeq, recordDatasetIds, recordsFor, withFitRecord, type ReflFitRecord } from "./reflFitRecord";
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
  /** "Add fit curves" already ran for the saved fit on show. */
  savedCurvesAdded: boolean;
  pick: (id: string | null) => void;
  /** Overlay the saved fit's channel-1 model on its dataset (no re-run). */
  showOverlay: () => void;
  /** Add the saved fit's stored curves to the library (no re-run). */
  addSavedCurves: () => string[];
  applySaved: () => void;
  restore: () => void;
  /** Store a finished fit, numbered from the CURRENT library. Returns the
   *  stored record, or null when none of its datasets is left (deleted while
   *  the fit ran) — then nothing is written, not even an undo step. */
  publish: (record: ReflFitRecord) => ReflFitRecord | null;
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
  const addDataset = useApp((s) => s.addDataset);
  const setFitOverlay = useApp((s) => s.setFitOverlay);
  // Curve datasets added per saved fit, so the button reads "added" and a
  // second click adds nothing twice.
  const [addedFor, setAddedFor] = useState<Record<string, string[]>>({});
  const host = datasets.find((d) => d.id === hostId);
  const records = recordsFor(host);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  // After a saved fit is applied, re-applying it stays allowed against the
  // stack it produced (the live fit's `basis` rule in useReflFit).
  const [appliedBasis, setAppliedBasis] = useState<{ id: string; layers: ModelLayer[]; radiation: Radiation } | null>(null);
  // The library as it is NOW, for `publish`: it runs after the fit's network
  // round trip, from a closure whose `datasets` is the render before it.
  // Tracked by subscription, not an imperative store read (the getState
  // ratchet); null until the store changes, when the render's copy is current.
  const liveDatasets = useRef<Dataset[] | null>(null);
  useEffect(
    () =>
      useApp.subscribe((s) => {
        liveDatasets.current = s.datasets;
      }),
    [],
  );

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

  function publish(record: ReflFitRecord): ReflFitRecord | null {
    setPickedId(null); // a new fit is the one on show
    const now = liveDatasets.current ?? datasets;
    const ids = recordDatasetIds(record);
    if (!now.some((d) => ids.includes(d.id))) return null; // deleted mid-fit
    const numbered = { ...record, seq: nextSeq(now, ids) };
    recordHistory("reflectivity fit");
    useApp.setState((s) => ({ datasets: withFitRecord(s.datasets, numbered) }));
    return numbered;
  }

  function showOverlay(): void {
    if (!selected) return;
    const overlay = savedOverlay(selected, datasets);
    if (typeof overlay === "string") {
      setError(`cannot overlay: ${overlay}`);
      return;
    }
    setFitOverlay(overlay);
    setStatus(`overlaid reflectivity fit #${selected.seq} on its data`);
  }

  function addSavedCurves(): string[] {
    if (!selected?.curves) return [];
    const done = addedFor[selected.id];
    if (done) return done;
    const fallback = { weighting: selected.result.weighting, radiation: selected.model.radiation };
    const ids = curveDatasets(selected.curves, selected, datasets, fallback).map((c) => {
      const id = nextDatasetId();
      addDataset({ id, name: c.name, data: c.data, ...c.placement });
      return id;
    });
    setAddedFor((m) => ({ ...m, [selected.id]: ids }));
    setStatus(`added ${ids.length} datasets from reflectivity fit #${selected.seq}`);
    return ids;
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
    savedCurvesAdded: selected != null && selected.id in addedFor,
    pick: setPickedId,
    showOverlay,
    addSavedCurves,
    applySaved,
    restore,
    publish,
    addToReport,
  };
}
