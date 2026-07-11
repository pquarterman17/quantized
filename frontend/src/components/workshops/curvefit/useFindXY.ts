// Find X from Y / Y from X (MAIN #15) — state hook for FindXYSection. Thin
// wrapper over POST /api/fitting/find-xy: X -> the fitted model's Y, or
// Y -> every X where the fitted curve crosses it within the fitted data
// range. Works for either a registry model or a saved custom equation (the
// route resolves both the same way) — the caller passes whichever it has.

import { useState } from "react";

import { findXY } from "../../../lib/api";

/** The fit this section inverse-evaluates: exactly one of model / equation,
 *  its fitted params, and the x-range the fit was run over. */
export interface FindXYTarget {
  model?: string;
  equation?: string;
  params: number[];
  xMin: number;
  xMax: number;
}

export interface FindXYState {
  xInput: string;
  setXInput: (v: string) => void;
  yInput: string;
  setYInput: (v: string) => void;
  yResult: number | null;
  xResults: number[] | null;
  busy: boolean;
  error: string | null;
  findY: () => Promise<void>;
  findX: () => Promise<void>;
}

export function useFindXY(target: FindXYTarget | null): FindXYState {
  const [xInput, setXInput] = useState("");
  const [yInput, setYInput] = useState("");
  const [yResult, setYResult] = useState<number | null>(null);
  const [xResults, setXResults] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function findY(): Promise<void> {
    if (!target) return;
    const x = Number(xInput);
    if (xInput.trim() === "" || !Number.isFinite(x)) {
      setError("enter a numeric X");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await findXY({
        model: target.model,
        equation: target.equation,
        params: target.params,
        x_min: target.xMin,
        x_max: target.xMax,
        x,
      });
      setYResult(r.y ?? null);
      setXResults(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "find Y failed");
    } finally {
      setBusy(false);
    }
  }

  async function findX(): Promise<void> {
    if (!target) return;
    const y = Number(yInput);
    if (yInput.trim() === "" || !Number.isFinite(y)) {
      setError("enter a numeric Y");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await findXY({
        model: target.model,
        equation: target.equation,
        params: target.params,
        x_min: target.xMin,
        x_max: target.xMax,
        y,
      });
      setXResults(r.x ?? []);
      setYResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "find X failed");
    } finally {
      setBusy(false);
    }
  }

  return { xInput, setXInput, yInput, setYInput, yResult, xResults, busy, error, findY, findX };
}
