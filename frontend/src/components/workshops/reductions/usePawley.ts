// Pawley refinement state for the Reductions workshop.
// Uses the active XRD dataset's time axis as 2θ and a selected intensity channel.
// Raw data are never modified; the fitted model can be added as a linked derived dataset.
//
// Fails closed unless the x axis is demonstrably a 2θ scan in DEGREES
// (`pawleyAxisProblem`: the fitted-peak table's rule, tightened against other
// angles, 2-D datasets and out-of-range x): a q, time, temperature or phi axis
// would otherwise be refined as if it were 2θ and return a plausible,
// meaningless cell. Every
// other refusal (a non-physical cell, too few points, a vanished column) is
// named in `blockedReason` next to the disabled Refine button, the way
// useWilliamsonHall does it.
//
// Numeric inputs are held as the TEXT the user typed, so an emptied field is
// NaN and refused rather than silently sent as 0.

import { useEffect, useMemo, useRef, useState } from "react";

import { dropGapRows } from "../../../lib/api/finitePairs";
import { pawleyRefine } from "../../../lib/api/reductions";
import { xAxisIsTwoThetaDegrees, xChannelIdentity } from "../../../lib/peakTableFit";
import type { PawleyResult } from "../../../lib/reductionTypes";
import { analysisData } from "../../../lib/rowstate";
import type { Dataset, DataStruct } from "../../../lib/types";
import { wavelengthFromMetadata } from "../../../lib/xrdWavelength";
import { nextDatasetId, useActiveDataset, useApp } from "../../../store/useApp";
import {
  PAWLEY_DEFAULT_FIELDS,
  PAWLEY_MAX_POINTS,
  type PawleyField,
  type PawleyFields,
  type PawleyTie,
  parseField,
  pawleyAxisProblem,
  pawleyInputProblem,
  pawleyNumbers,
  pawleyVerdict,
  scanRange,
} from "./pawleyInputs";

export type PawleyCentering = "P" | "F" | "I" | "A" | "B" | "C" | "R";

export interface PawleyState {
  active: Dataset | null;
  columns: { index: number; label: string }[];
  col: number;
  setCol: (v: number) => void;
  fields: PawleyFields;
  setField: (k: PawleyField, v: string) => void;
  tie: PawleyTie;
  setTie: (v: PawleyTie) => void;
  symmetry: PawleyCentering;
  setSymmetry: (v: PawleyCentering) => void;
  /** The wavelength field still holds the value read from the file. */
  wavelengthFromFile: boolean;
  refineCell: boolean;
  setRefineCell: (v: boolean) => void;
  result: PawleyResult | null;
  /** The 2θ window the shown result was fit over. */
  fitRange: { min: number; max: number } | null;
  /** Whether the shown result refined the cell (the verdict depends on it). */
  fitRefined: boolean;
  busy: boolean;
  error: string | null;
  /** Why Refine must not be pressed, or null when every input is sound. */
  blockedReason: string | null;
  canCompute: boolean;
  compute: () => Promise<void>;
  toLibrary: () => void;
}

/** Everything `toLibrary` needs, frozen at the moment the fit returned, so a
 *  later edit to the panel or the source cannot relabel an old result. */
interface PawleyFitInput {
  x: number[];
  y: number[];
  range: { min: number; max: number };
  sourceId: string;
  sourceName: string;
  label: string;
  unit: string;
  xLabel: string;
  symmetry: PawleyCentering;
  wavelength: number;
  profileFwhm: number;
  refineCell: boolean;
  /** The source's own measured-wavelength keys, carried to the derived set. */
  measured: Record<string, unknown>;
}

const MEASURED_WAVELENGTH_KEYS = ["wavelength_a", "alpha_average"] as const;

export function usePawley(): PawleyState {
  const active = useActiveDataset();
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);
  const columns = active
    ? active.data.labels.map((label, index) => ({ index, label: label || `Column ${index + 1}` }))
    : [];

  const [col, setCol] = useState(0);
  const [fields, setFields] = useState<PawleyFields>(PAWLEY_DEFAULT_FIELDS);
  const [tie, setTieState] = useState<PawleyTie>("abc");
  const [symmetry, setSymmetry] = useState<PawleyCentering>("P");
  const [fileWavelength, setFileWavelength] = useState<number | null>(null);
  const [refineCell, setRefineCell] = useState(true);
  const [result, setResult] = useState<PawleyResult | null>(null);
  const [fitInput, setFitInput] = useState<PawleyFitInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bumped on every dataset switch and every compute(); a completion whose
  // token is no longer current belongs to a dataset or click the user has
  // since left, and is discarded.
  const runToken = useRef(0);

  const activeId = active?.id;
  const activeMetadata = active?.data.metadata;
  useEffect(() => {
    runToken.current += 1;
    setCol(0);
    setResult(null);
    setFitInput(null);
    setError(null);
    setBusy(false);
    // Seed λ from the file, as Williamson-Hall and the peak table do; a typed
    // Cu default on a Mo pattern refines to a cell ~8 % too large. A dataset
    // that records none keeps whatever λ the user last had.
    const measured = wavelengthFromMetadata(activeMetadata);
    setFileWavelength(measured);
    if (measured != null) setFields((f) => ({ ...f, wavelength: String(measured) }));
    // Only a switch of dataset reseeds; a metadata edit on the same dataset
    // must not overwrite what the user typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const setField = (k: PawleyField, v: string): void => setFields((f) => ({ ...f, [k]: v }));

  // Releasing a tie reveals b/c fields the user could not see: give them a's
  // value, which is what they were showing, rather than stale earlier text.
  const setTie = (next: PawleyTie): void => {
    setFields((f) => ({
      ...f,
      b: tie !== "none" && next === "none" ? f.a : f.b,
      c: tie === "abc" && next !== "abc" ? f.a : f.c,
    }));
    setTieState(next);
  };

  const xIdentity = active ? xChannelIdentity(active.data, null) : null;
  const numbers = pawleyNumbers(fields, tie);
  const colValid = active != null && col >= 0 && col < active.data.labels.length;

  const scan = useMemo(() => {
    if (!active || !colValid) return null;
    const pairs = dropGapRows(active.data.time, active.data.values.map((row) => row[col]));
    return { n: pairs.keep.length, range: pairs.keep.length ? scanRange(pairs.x) : null };
  }, [active, col, colValid]);

  let blockedReason: string | null = null;
  if (active && xIdentity) {
    blockedReason =
      pawleyAxisProblem(xIdentity, active.data.metadata, scan?.range ?? null) ??
      (!colValid ? "pick an intensity channel" : null) ??
      pawleyInputProblem(numbers) ??
      (scan && scan.n >= 3 ? null : "need at least 3 finite points in the selected channel") ??
      (scan && scan.n > PAWLEY_MAX_POINTS
        ? `the scan has ${scan.n} points; the limit is ${PAWLEY_MAX_POINTS}`
        : null);
  }
  const canCompute = active != null && blockedReason == null;

  async function compute(): Promise<void> {
    if (!active || !canCompute || !xIdentity) return;
    const token = ++runToken.current;
    const n = numbers;
    setBusy(true);
    setError(null);
    try {
      const ds = await useApp.getState().resolveDataset(active.id);
      if (!ds) throw new Error("Could not load the full dataset.");
      const d = analysisData(ds) ?? ds.data;
      const pairs = dropGapRows(d.time, d.values.map((row) => row[col]));
      if (pairs.keep.length < 3) throw new Error("Pawley refinement needs at least 3 finite points.");
      const range = scanRange(pairs.x);
      if (!(range.max > range.min)) throw new Error("The scan covers a single 2θ value.");
      const res = await pawleyRefine({
        two_theta: pairs.x,
        intensity: pairs.y,
        a: n.a,
        b: n.b,
        c: n.c,
        alpha: n.alpha,
        beta: n.beta,
        gamma: n.gamma,
        symmetry,
        tie,
        wavelength: n.wavelength,
        // Only reflections inside the measured scan are fit and counted. A
        // scan through the direct beam starts below 0; no reflection lives there.
        min_two_theta: Math.max(0, range.min),
        max_two_theta: range.max,
        profile_fwhm: n.fwhm,
        refine_cell: refineCell,
      });
      if (token !== runToken.current) return;
      const len = pairs.x.length;
      if (res.model.length !== len || res.residual.length !== len || res.background.length !== len) {
        throw new Error(`The backend returned ${res.model.length} model points for ${len} observed.`);
      }
      const measured: Record<string, unknown> = {};
      for (const k of MEASURED_WAVELENGTH_KEYS) {
        if (ds.data.metadata?.[k] != null) measured[k] = ds.data.metadata[k];
      }
      setResult(res);
      setFitInput({
        x: pairs.x,
        y: pairs.y,
        range,
        sourceId: ds.id,
        sourceName: ds.name,
        label: ds.data.labels[col] || "Observed",
        unit: ds.data.units[col] || "",
        xLabel: xIdentity.xLabel,
        symmetry,
        wavelength: n.wavelength,
        profileFwhm: n.fwhm,
        refineCell,
        measured,
      });
    } catch (e) {
      if (token !== runToken.current) return;
      setResult(null);
      setFitInput(null);
      setError(e instanceof Error ? e.message : "Pawley refinement failed");
    } finally {
      if (token === runToken.current) setBusy(false);
    }
  }

  function toLibrary(): void {
    if (!result || !fitInput) return;
    const f = fitInput;
    // Keep the source's own name only when it alone reads as 2θ; a label that
    // passed only on its "deg" unit (e.g. "x") is replaced.
    const xName = xAxisIsTwoThetaDegrees({ xLabel: f.xLabel, xUnit: "" }) ? f.xLabel : "2Theta";
    const data: DataStruct = {
      time: f.x,
      values: f.x.map((_, i) => [f.y[i], result.model[i], result.background[i], result.residual[i]]),
      labels: [f.label, "Pawley model", "Background", "Residual"],
      units: [f.unit, f.unit, f.unit, f.unit],
      metadata: {
        // The measured wavelength (if the source had one) stays under the
        // parser keys; the value the fit USED is recorded under `pawley`, so
        // a typed default is never mistaken for an instrument reading.
        ...f.measured,
        reduction: "pawley",
        source_dataset_id: f.sourceId,
        technique: "xrd.powder",
        x_column_name: xName,
        x_column_long: xName,
        x_column_unit: "deg",
        pawley: {
          cell_initial: result.cell_initial,
          cell_refined: result.cell,
          tie: result.tie,
          symmetry: f.symmetry,
          wavelength_a: f.wavelength,
          profile_fwhm_deg: f.profileFwhm,
          refine_cell: f.refineCell,
          hkl_max: result.hkl_max,
          two_theta_range_deg: [f.range.min, f.range.max],
          rwp: result.rwp,
          rwp_initial: result.rwp_initial,
          converged: result.converged,
          rwp_background: result.rwp_background,
          warning: pawleyVerdict(result, f.refineCell),
          peaks: result.peaks,
        },
      },
    };
    addDataset({ id: nextDatasetId(), name: `${f.sourceName} (Pawley)`, data });
    setStatus("added Pawley observed/model/background/residual dataset");
  }

  const wavelengthFromFile = fileWavelength != null && parseField(fields.wavelength) === fileWavelength;

  return {
    active, columns, col, setCol,
    fields, setField, tie, setTie,
    symmetry, setSymmetry,
    wavelengthFromFile,
    refineCell, setRefineCell,
    result, fitRange: fitInput?.range ?? null, fitRefined: fitInput?.refineCell ?? false,
    busy, error, blockedReason, canCompute, compute, toLibrary,
  };
}
