// Power & sample size: state hook. The answer follows the form (a short debounce,
// the previous request aborted), so there is no Calculate button to forget.

import { useEffect, useState } from "react";

import { statsPowerSolve, type PowerSolveBody, type PowerSolveResult } from "../../../lib/api/statsPower";
import { isAbortError } from "../workbench/useWorkbenchPreview";
import { buildBody, defaultForm, withTest, type PowerForm } from "./powerModel";

export interface PowerState {
  form: PowerForm;
  set: (patch: Partial<PowerForm>) => void;
  setTest: (t: PowerForm["test"]) => void;
  result: PowerSolveResult | null;
  /** Why there is no answer: a field still empty, or the solver's refusal. */
  problem: string | null;
}

export function usePower(): PowerState {
  const [form, setForm] = useState<PowerForm>(defaultForm);
  const [answer, setAnswer] = useState<{ key: string; result?: PowerSolveResult; error?: string } | null>(null);
  const built = buildBody(form);
  const key = "body" in built ? JSON.stringify(built.body) : "";
  useEffect(() => {
    if (!key) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      statsPowerSolve(JSON.parse(key) as PowerSolveBody, ctl.signal).then(
        (result) => setAnswer({ key, result }),
        (e: unknown) => {
          if (!ctl.signal.aborted && !isAbortError(e)) setAnswer({ key, error: e instanceof Error ? e.message : "the calculation failed" });
        },
      );
    }, 150);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [key]);
  const current = answer && answer.key === key ? answer : null;
  return {
    form,
    set: (patch) => setForm((f) => ({ ...f, ...patch })),
    setTest: (t) => setForm((f) => withTest(f, t)),
    result: current?.result ?? null,
    problem: "missing" in built ? `Enter ${built.missing}.` : (current?.error ?? null),
  };
}
