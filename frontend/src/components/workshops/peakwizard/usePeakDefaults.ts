// Peak Analyzer — the two stateful halves of the sensible defaults (UX audit 7
// #8, lane UX-I; the pure rules are ./peakDefaults):
//
//  * useAutoBaseline: once per dataset, while the user has not chosen a
//    baseline (nor applied a recipe) in this panel, start step ① from SNIP
//    when the plot is log-Y or the trace decays, else from None. A dataset
//    switched to on a LATER step keeps the method (the peaks and fit shown
//    were made with it). `settled` is false until that decision is made, so
//    the wizard's automatic peak finds wait for it rather than run on the raw
//    trace a moment before the baseline arrives.
//  * useFitOnEntry: step ④ runs the fit on entry (Origin's Peak Analyzer
//    does), unless a result (current or stale), a running fit, a parameter
//    problem, or the last attempt's error / cancel / publish note is
//    showing. `rerun` re-arms it after a configuration change made from
//    step ④ itself ("Fit the 8 strongest").
//    It MUST be called after useModelFit in the same component: its effect
//    then runs after the model's own reset-on-change effect in the same
//    commit, so the run it starts is never the one that reset cancels.
//  * useAutoShape: the recipe's peak shape follows the dataset (pseudo-Voigt
//    on XRD / Raman, ./peakDefaults `defaultPeakShape`) until the user picks
//    a shape or applies a recipe.

import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_RECIPE, type PeakBaselineMethod } from "../../../lib/peakwizard";
import { suggestedBaseline } from "./peakDefaults";
import type { ModelFitState } from "./useModelFit";

export interface AutoBaselineInputs {
  activeId: string | null;
  /** The working segment's x and raw y (row order), or null without one. */
  x: readonly number[] | null;
  y: readonly number[] | null;
  /** The wizard step showing: only step ① (0) re-decides on a dataset switch. */
  step: number;
  yLog: boolean;
  method: PeakBaselineMethod;
  apply: (method: PeakBaselineMethod) => void;
}

export interface AutoBaseline {
  settled: boolean;
  /** The method chosen automatically, while it is still the recipe's. */
  chosen: PeakBaselineMethod | null;
  /** The user chose a baseline (or applied a recipe): never override it. */
  touched: () => void;
}

export function useAutoBaseline({ activeId, x, y, step, yLog, method, apply }: AutoBaselineInputs): AutoBaseline {
  const [decidedFor, setDecidedFor] = useState<string | null>(null);
  const [chosen, setChosen] = useState<PeakBaselineMethod | null>(null);
  const touchedRef = useRef(false);
  useEffect(() => {
    if (!activeId || !x || !y || decidedFor === activeId) return; // decided on data, never on its absence
    setDecidedFor(activeId);
    if (decidedFor !== null && step !== 0) {
      setChosen(null); // kept, not chosen for this dataset: no "because" note
      return;
    }
    // Each dataset decides afresh while the method is still the default or an
    // earlier automatic pick: a flat dataset after a decaying one goes back
    // to None rather than inherit (and mis-explain) the other's SNIP.
    if (touchedRef.current || (method !== "none" && method !== chosen)) return;
    const pick = suggestedBaseline(x, y, yLog);
    if ((pick ?? "none") !== method) apply(pick ?? "none");
    setChosen(pick);
  }, [activeId, decidedFor, x, y, step, yLog, method, chosen, apply]);
  const touched = useCallback(() => {
    touchedRef.current = true;
    setChosen(null);
  }, []);
  // Nothing to find on without data, so no find waits on a decision then.
  return { settled: !activeId || !x || !y || decidedFor === activeId, chosen: chosen === method ? chosen : null, touched };
}

/** `pick`: the dataset's default shape (null without one). Returns `touched`. */
export function useAutoShape(pick: string | null, shape: string, apply: (shape: string) => void): () => void {
  const touchedRef = useRef(false);
  const last = useRef<string | null>(null); // the shape this hook last set
  useEffect(() => {
    // Never over a shape someone else set (a recipe applied, a pick).
    if (pick === null || touchedRef.current || shape !== (last.current ?? DEFAULT_RECIPE.model.shape)) return;
    last.current = pick;
    if (pick !== shape) apply(pick);
  }, [pick, shape, apply]);
  return useCallback(() => {
    touchedRef.current = true;
  }, []);
}

export interface ClassicFit {
  busy: boolean;
  hasResult: boolean;
  hasError: boolean;
  run: () => Promise<void>;
}

export function useFitOnEntry(step: number, hasPeaks: boolean, m: ModelFitState, classic: ClassicFit): () => void {
  const [armed, setArmed] = useState<"entry" | "rerun" | null>(null);
  useEffect(() => {
    if (step === 3) setArmed("entry");
  }, [step]);
  useEffect(() => {
    if (!armed) return;
    setArmed(null);
    if (step !== 3 || !hasPeaks) return;
    if (m.engine === "model") {
      // Entry leaves alone anything the user should read first: a result
      // (even a stale one: Re-fit is theirs to press), an error, a cancel or a
      // publish refusal, all of which a run would replace. A rerun follows a
      // change that reset the model this commit, so those are about to clear.
      const showing = !!(m.result || m.error || m.notice || m.publishNote);
      if (!m.busy && !m.publishing && !(armed === "entry" && showing) && m.problems.length === 0) void m.run();
    } else if (!classic.busy && !classic.hasResult && !(armed === "entry" && classic.hasError)) {
      void classic.run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per arming, with this render's model
  }, [armed]);
  return useCallback(() => setArmed("rerun"), []);
}
