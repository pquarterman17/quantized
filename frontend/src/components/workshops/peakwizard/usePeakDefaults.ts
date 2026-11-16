// Peak Analyzer — the two stateful halves of the sensible defaults (UX audit 7
// #8, lane UX-I; the pure rules are ./peakDefaults):
//
//  * useAutoBaseline: once per dataset, while the user has not chosen a
//    baseline (nor applied a recipe), start step ① from SNIP when the plot is
//    log-Y or the trace decays. `settled` is false until that decision is
//    made, so the wizard's automatic peak finds wait for it rather than run on
//    the raw trace a moment before the baseline arrives.
//  * useFitOnEntry: step ④ runs the fit on entry (Origin's Peak Analyzer
//    does), unless a result (current or stale), a running fit, a parameter
//    problem, or the last attempt's error / cancel / publish note is showing. `rerun` re-arms it after a
//    configuration change made from step ④ itself ("Fit the 8 strongest").
//    It MUST be called after useModelFit in the same component: its effect
//    then runs after the model's own reset-on-change effect in the same
//    commit, so the run it starts is never the one that reset cancels.

import { useCallback, useEffect, useRef, useState } from "react";

import type { PeakBaselineMethod } from "../../../lib/peakwizard";
import { suggestedBaseline } from "./peakDefaults";
import type { ModelFitState } from "./useModelFit";

export interface AutoBaselineInputs {
  activeId: string | null;
  /** The working segment's raw y, or null when there is no segment. */
  y: readonly number[] | null;
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

export function useAutoBaseline({ activeId, y, yLog, method, apply }: AutoBaselineInputs): AutoBaseline {
  const [decidedFor, setDecidedFor] = useState<string | null>(null);
  const [chosen, setChosen] = useState<PeakBaselineMethod | null>(null);
  const touchedRef = useRef(false);
  useEffect(() => {
    if (!activeId || !y || decidedFor === activeId) return; // decided on data, never on its absence
    const pick = !touchedRef.current && method === "none" ? suggestedBaseline(y, yLog) : null;
    if (pick) {
      apply(pick);
      setChosen(pick);
    }
    setDecidedFor(activeId);
  }, [activeId, decidedFor, y, yLog, method, apply]);
  const touched = useCallback(() => {
    touchedRef.current = true;
    setChosen(null);
  }, []);
  // Nothing to find on without data, so no find waits on a decision then.
  return { settled: !activeId || !y || decidedFor === activeId, chosen: chosen === method ? chosen : null, touched };
}

export interface ClassicFit {
  busy: boolean;
  hasResult: boolean;
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
    } else if (!classic.busy && !classic.hasResult) {
      void classic.run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per arming, with this render's model
  }, [armed]);
  return useCallback(() => setArmed("rerun"), []);
}
