// Pawley refinement state for the Reductions workshop.
// Uses the active XRD dataset's time axis as 2θ and a selected intensity channel.
// Raw data are never modified; the fitted model can be added as a linked derived dataset.

import { useEffect, useState } from "react";

import { dropGapRows } from "../../../lib/api/finitePairs";
import { pawleyRefine } from "../../../lib/api/reductions";
import type { PawleyResult } from "../../../lib/reductionTypes";
import { analysisData } from "../../../lib/rowstate";
import type { Dataset, DataStruct } from "../../../lib/types";
import { nextDatasetId, useActiveDataset, useApp } from "../../../store/useApp";

export interface PawleyState {
  active: Dataset | null;
  columns: { index: number; label: string }[];
  col: number;
  setCol: (v: number) => void;
  a: number;
  b: number;
  c: number;
  setA: (v: number) => void;
  setB: (v: number) => void;
  setC: (v: number) => void;
  symmetry: string;
  setSymmetry: (v: string) => void;
  wavelength: number;
  setWavelength: (v: number) => void;
  profileFwhm: number;
  setProfileFwhm: (v: number) => void;
  refineCell: boolean;
  setRefineCell: (v: boolean) => void;
  result: PawleyResult | null;
  busy: boolean;
  error: string | null;
  compute: () => Promise<void>;
  toLibrary: () => void;
}

export function usePawley(): PawleyState {
  const active = useActiveDataset();
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);
  const columns = active
    ? active.data.labels.map((label, index) => ({ index, label: label || `Column ${index + 1}` }))
    : [];

  const [col, setCol] = useState(0);
  const [a, setA] = useState(5.43);
  const [b, setB] = useState(5.43);
  const [c, setC] = useState(5.43);
  const [symmetry, setSymmetry] = useState("P");
  const [wavelength, setWavelength] = useState(1.5406);
  const [profileFwhm, setProfileFwhm] = useState(0.12);
  const [refineCell, setRefineCell] = useState(true);
  const [result, setResult] = useState<PawleyResult | null>(null);
  const [fitInput, setFitInput] = useState<{ x: number[]; y: number[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCol(0);
    setResult(null);
    setFitInput(null);
    setError(null);
  }, [active?.id]);

  async function compute(): Promise<void> {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      const ds = await useApp.getState().resolveDataset(active.id);
      if (!ds) throw new Error("Could not load the full dataset.");
      const d = analysisData(ds) ?? ds.data;
      const pairs = dropGapRows(d.time, d.values.map((row) => row[col]));
      if (pairs.keep.length < 3) throw new Error("Pawley refinement needs at least 3 finite points.");
      const res = await pawleyRefine({
        two_theta: pairs.x,
        intensity: pairs.y,
        a,
        b,
        c,
        symmetry,
        wavelength,
        profile_fwhm: profileFwhm,
        refine_cell: refineCell,
      });
      setResult(res);
      setFitInput({ x: pairs.x, y: pairs.y });
    } catch (e) {
      setResult(null);
      setFitInput(null);
      setError(e instanceof Error ? e.message : "Pawley refinement failed");
    } finally {
      setBusy(false);
    }
  }

  function toLibrary(): void {
    if (!active || !result || !fitInput) return;
    const data: DataStruct = {
      time: fitInput.x,
      values: fitInput.x.map((_, i) => [fitInput.y[i], result.model[i], result.residual[i]]),
      labels: [active.data.labels[col] || "Observed", "Pawley model", "Residual"],
      units: [active.data.units[col] || "", active.data.units[col] || "", active.data.units[col] || ""],
      metadata: {
        reduction: "pawley",
        source_dataset_id: active.id,
        refined_cell: result.cell,
        rwp: result.rwp,
        symmetry,
        wavelength_a: wavelength,
      },
    };
    addDataset({ id: nextDatasetId(), name: `${active.name} (Pawley)`, data });
    setStatus("added Pawley observed/model/residual dataset");
  }

  return {
    active, columns, col, setCol,
    a, b, c, setA, setB, setC,
    symmetry, setSymmetry,
    wavelength, setWavelength,
    profileFwhm, setProfileFwhm,
    refineCell, setRefineCell,
    result, busy, error, compute, toLibrary,
  };
}
