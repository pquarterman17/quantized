// Fit solver limits (owner decision 2026-11-25): clamped on load, sent with a
// single fit / equation fit / by-handle fit ONLY when they differ from the
// defaults, so untouched Preferences leaves every request byte-identical and
// the goldens untouched.

import { afterEach, describe, expect, it, vi } from "vitest";

import { fitEquation } from "./api/curvefit";
import { fitModel } from "./apiLazy";
import {
  FIT_PREFS_KEY,
  FIT_SOLVER_DEFAULTS,
  bootstrapCap,
  fitPrefsSlot,
  fitSolverFields,
  saveBootstrapCap,
  validSolverValue,
} from "./fitPrefs";
import { postBySource } from "./fitSource";

const ok = () => Promise.resolve({ ok: true, status: 200, statusText: "OK", headers: new Headers(), json: () => Promise.resolve({}) } as unknown as Response);
function bodies(): Record<string, unknown>[] {
  return vi.mocked(fetch).mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)) as Record<string, unknown>);
}
const REQ = { model: "Linear", x: [1, 2], y: [1, 2] };

afterEach(() => {
  localStorage.removeItem(FIT_PREFS_KEY);
  vi.unstubAllGlobals();
});

describe("fit solver prefs", () => {
  it("defaults are calc.fitting's (5000 per parameter, 1e-12, 1e-10)", () => {
    expect(fitPrefsSlot.load()).toMatchObject({ maxIterPerParam: 5000, tolFun: 1e-12, tolX: 1e-10 });
  });

  it("an out-of-range or non-numeric stored value falls back to its default", () => {
    localStorage.setItem(FIT_PREFS_KEY, JSON.stringify({ maxIterPerParam: 5, tolFun: 0.5, tolX: "tight", bootstrapCap: 300 }));
    expect(fitPrefsSlot.load()).toMatchObject({ ...FIT_SOLVER_DEFAULTS });
    expect(bootstrapCap()).toBe(300);
    expect(validSolverValue("maxIterPerParam", 150.5)).toBeNull();
    expect(validSolverValue("maxIterPerParam", 150)).toBe(150);
    expect(validSolverValue("tolFun", 1e-16)).toBeNull();
    expect(validSolverValue("tolX", 1e-3)).toBe(1e-3);
  });

  it("saving the bootstrap cap keeps the solver values", () => {
    fitPrefsSlot.save({ ...fitPrefsSlot.load(), maxIterPerParam: 900 });
    saveBootstrapCap(500);
    expect(fitPrefsSlot.load().maxIterPerParam).toBe(900);
  });

  it("defaults send nothing; only changed fields go out; other paths get nothing", () => {
    expect(fitSolverFields("/api/fitting/fit")).toEqual({});
    fitPrefsSlot.save({ ...fitPrefsSlot.load(), maxIterPerParam: 900, tolX: 1e-8 });
    expect(fitSolverFields("/api/fitting/fit")).toEqual({ max_iter_per_param: 900, tol_x: 1e-8 });
    expect(fitSolverFields("/api/fitting/equation/fit")).toEqual({ max_iter_per_param: 900, tol_x: 1e-8 });
    expect(fitSolverFields("/api/peaks/fit")).toEqual({});
  });

  it("fitModel and fitEquation bodies: unchanged by default, carry the limits when set", async () => {
    vi.stubGlobal("fetch", vi.fn(ok));
    await fitModel(REQ as never);
    await fitEquation({ equation: "a*x", x: [1], y: [1] } as never);
    expect(bodies()[0]).toEqual(REQ);
    expect(bodies()[1]).toEqual({ equation: "a*x", x: [1], y: [1] });
    fitPrefsSlot.save({ ...fitPrefsSlot.load(), maxIterPerParam: 1200, tolFun: 1e-9 });
    await fitModel(REQ as never);
    await fitEquation({ equation: "a*x", x: [1], y: [1] } as never);
    expect(bodies()[2]).toEqual({ ...REQ, max_iter_per_param: 1200, tol_fun: 1e-9 });
    expect(bodies()[3]).toMatchObject({ max_iter_per_param: 1200, tol_fun: 1e-9 });
  });

  it("the arrays fallback of postBySource goes through fitModel, so it carries them too", async () => {
    vi.stubGlobal("fetch", vi.fn(ok));
    fitPrefsSlot.save({ ...fitPrefsSlot.load(), tolX: 1e-7 });
    await postBySource("/api/fitting/fit", REQ, undefined, [0, 1], () => fitModel(REQ as never));
    expect(bodies()[0]).toMatchObject({ tol_x: 1e-7 });
  });
});
