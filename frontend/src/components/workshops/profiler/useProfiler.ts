// Profiler workshop (GAP_AUDIT_9 G7): state hook. Picks the model (the one
// Fit Model handed over, or a saved Fit Model result's `parameters.model`),
// keeps the current factor settings, and asks the backend for every factor's
// curve in ONE debounced request per change (calc/profile_model.py), so a
// slider drag never means one request per point. A response is shown only
// while it belongs to the current model + settings + goal.

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  statsDesirability, statsProfile, type GoalSpec, type ProfileResponse, type ProfilerModel, type ProfilerSettings,
} from "../../../lib/api/modelEvaluate";
import { FIT_MODEL_PRODUCER } from "../../../lib/fitModelRecipe";
import { defaultSettings, profilerFactors, profilerProblem, type ProfilerFactor } from "../../../lib/profiler";
import { useProfilerStore } from "../../../store/profiler";
import { useApp } from "../../../store/useApp";

export const DEBOUNCE_MS = 120;
export const LIVE_ID = "live";

export interface ProfilerSource {
  id: string;
  label: string;
  model: ProfilerModel;
}

export interface GoalDraft {
  on: boolean;
  goal: GoalSpec["goal"];
  lower: number;
  upper: number;
  target: number;
}

export interface ProfilerState {
  sources: ProfilerSource[];
  sourceId: string;
  setSourceId: (id: string) => void;
  model: ProfilerModel | null;
  factors: ProfilerFactor[];
  problem: string | null;
  settings: ProfilerSettings;
  setSetting: (name: string, value: number | string | null) => void;
  reset: () => void;
  alpha: number;
  setAlpha: (alpha: number) => void;
  goal: GoalDraft;
  setGoal: (goal: GoalDraft) => void;
  goalSpec: GoalSpec | null;
  maximize: () => void;
  profile: ProfileResponse | null;
  /** `profile` belongs to earlier settings; a fresh one is being fetched. */
  stale: boolean;
  error: string | null;
  busy: boolean;
}

function asModel(v: unknown): ProfilerModel | null {
  const m = v as ProfilerModel | undefined;
  return m && Array.isArray(m.factors) && Array.isArray(m.terms) && Array.isArray(m.coefficients) ? m : null;
}

export function useProfiler(): ProfilerState {
  const request = useProfilerStore((s) => s.request);
  const results = useApp((s) => s.analysisResults);
  const sources = useMemo<ProfilerSource[]>(() => {
    const saved = results.flatMap((r): ProfilerSource[] => {
      const model = r.producer.id === FIT_MODEL_PRODUCER ? asModel(r.parameters?.["model"]) : null;
      return model ? [{ id: r.id, label: `Saved: ${r.name}`, model }] : [];
    });
    return request ? [{ id: LIVE_ID, label: `Open fit: ${request.label}`, model: request.model }, ...saved] : saved;
  }, [request, results]);
  const [picked, setPicked] = useState<string | null>(null);
  const sourceId = sources.find((s) => s.id === picked)?.id ?? sources[0]?.id ?? "";
  const model = sources.find((s) => s.id === sourceId)?.model ?? null;
  // A fresh hand-over from Fit Model always wins over an earlier pick.
  useEffect(() => { if (request) setPicked(LIVE_ID); }, [request]);

  const factors = useMemo(() => (model ? profilerFactors(model) : []), [model]);
  const problem = model ? profilerProblem(model) : null;
  const [settings, setSettings] = useState<ProfilerSettings>({});
  useEffect(() => { setSettings(model ? defaultSettings(model) : {}); }, [model]);
  const setSetting = useCallback((name: string, value: number | string | null) => {
    setSettings((s) => ({ ...s, [name]: value }));
  }, []);
  const reset = useCallback(() => { if (model) setSettings(defaultSettings(model)); }, [model]);
  const [alpha, setAlpha] = useState(0.05);
  const [goal, setGoal] = useState<GoalDraft>({ on: false, goal: "maximize", lower: 0, upper: 1, target: 0.5 });
  const goalSpec = useMemo<GoalSpec | null>(() => {
    if (!goal.on || !(goal.lower < goal.upper)) return null;
    if (goal.goal === "target" && !(goal.lower < goal.target && goal.target < goal.upper)) return null;
    return { goal: goal.goal, lower: goal.lower, upper: goal.upper, target: goal.goal === "target" ? goal.target : null };
  }, [goal]);

  const key = useMemo(() => JSON.stringify([settings, alpha, goalSpec]), [alpha, goalSpec, settings]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ model: ProfilerModel; key: string; message: string } | null>(null);
  const [done, setDone] = useState<{ model: ProfilerModel; key: string; profile: ProfileResponse } | null>(null);
  const ready = model && !problem && factors.every((f) => f.name in settings);
  useEffect(() => {
    if (!model || !ready) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      statsProfile({ model, current: settings, alpha, goal: goalSpec }, controller.signal).then(
        (profile) => { if (!controller.signal.aborted) setDone({ model, key, profile }); },
        (e: unknown) => {
          if (!controller.signal.aborted) setFailure({ model, key, message: e instanceof Error ? e.message : "Profiler failed" });
        },
      ).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the settings/alpha/goal identity
  }, [model, ready, key]);
  // The previous response of the SAME model stays on screen while a new one is
  // in flight: unmounting the traces mid-drag would drop the slider and its
  // pointer capture. `stale` marks it (the readout dims, aria-busy).
  const profile = done && done.model === model ? done.profile : null;
  const stale = !!done && done.key !== key;
  const error = failure && failure.model === model && failure.key === key ? failure.message : null;

  const [maximizeError, setMaximizeError] = useState<string | null>(null);
  const maximize = useCallback(() => {
    if (!model || !goalSpec) return;
    setMaximizeError(null);
    statsDesirability({ model, goal: goalSpec }).then(
      (r) => setSettings((s) => ({ ...s, ...r.settings })),
      (e: unknown) => setMaximizeError(e instanceof Error ? e.message : "Maximize desirability failed"),
    );
  }, [goalSpec, model]);

  return {
    sources, sourceId, setSourceId: setPicked, model, factors, problem, settings, setSetting, reset, alpha, setAlpha,
    goal, setGoal, goalSpec, maximize, profile, stale, error: error ?? maximizeError, busy,
  };
}
