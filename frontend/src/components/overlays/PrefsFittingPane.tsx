// Preferences ▸ Fitting: the bootstrap cap plus the solver limits (owner
// decision 2026-11-25). The solver rows ride on `qz.fitPrefs`
// (lib/fitPrefs.ts); non-default values are sent with /fit and
// /equation/fit, defaults send nothing, so goldens are untouched.

import {
  FIT_SOLVER_DEFAULTS,
  FIT_SOLVER_RANGES,
  fitPrefsSlot,
  validSolverValue,
  type FitSolverKey,
} from "../../lib/fitPrefs";
import { BootstrapCapPref } from "./BootstrapCapPref";
import PrefNumberRow from "./PrefNumberRow";

const fmt = (n: number): string => (n >= 1 ? n.toLocaleString("en-US") : n.toExponential());

function Solver({ k, label, hint }: { k: FitSolverKey; label: string; hint: string }) {
  const value = fitPrefsSlot.use()[k];
  const [lo, hi] = FIT_SOLVER_RANGES[k];
  return (
    <PrefNumberRow
      label={label}
      hint={hint}
      value={value}
      width={104}
      parse={(t) => validSolverValue(k, Number(t))}
      range={`${k === "maxIterPerParam" ? "a whole number " : "a number "}from ${fmt(lo)} to ${fmt(hi)}`}
      onSave={(n) => fitPrefsSlot.save({ ...fitPrefsSlot.load(), [k]: n })}
    />
  );
}

export default function PrefsFittingPane() {
  const d = FIT_SOLVER_DEFAULTS;
  return (
    <>
      <BootstrapCapPref />
      <Solver k="maxIterPerParam" label="Fit max iterations per parameter" hint={`times the free parameters; a fit that runs out reports no convergence (default ${fmt(d.maxIterPerParam)})`} />
      <Solver k="tolFun" label="Fit function tolerance" hint={`stop when the cost stops improving by this much (default ${fmt(d.tolFun)})`} />
      <Solver k="tolX" label="Fit parameter tolerance" hint={`stop when the parameters stop moving by this much (default ${fmt(d.tolX)})`} />
    </>
  );
}
