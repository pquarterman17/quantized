// Peaks' preset adapter: the shared contract, plus the peak-recipe backend
// (plans/PRESET_BAR_CONTRACT.md P1 and P3): existing peak recipes load and list,
// a preset saved from the bar is a valid peak recipe for the old path, and
// records this build cannot read are never touched.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportNameKeyed, importNameKeyed } from "../../../lib/nameKeyedRecipes";
import { describePresetAdapterContract } from "../../../lib/presetAdapterContract.testkit";
import { DEFAULT_RECIPE, loadRecipes, loadRecipesChecked, type PeakRecipe } from "../../../lib/peakwizard";
import { DEFAULT_PEAK_FIND, type PeakFindParams } from "./peakFindParams";
import { createPeaksAdapter } from "./presetAdapter";
import { DEFAULT_PEAK_FIT_OPTIONS, type PeakPresetSettings } from "./peakPresetSettings";
import type { PeakFitOptions } from "./peakTypes";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));

const state = { draft: { ...DEFAULT_PEAK_FIND } as PeakFindParams, fit: { ...DEFAULT_PEAK_FIT_OPTIONS } as PeakFitOptions };
const adapter = createPeaksAdapter({
  getDraft: () => state.draft, getFitOptions: () => state.fit,
  setDraft: (f) => { state.draft = f; }, setFitOptions: (f) => { state.fit = f; },
});
const sample: PeakPresetSettings = {
  sensitivity: "high", snr_threshold: 2.5, min_prominence: 0.1, max_peaks: 7, min_separation: 0.3, min_width_deg: 0.05,
  max_width_deg: 4, bg_method: "polynomial", max_window_deg: 3, bg_poly_degree: 2, bg_iterative: true, strict_prominence: true,
  finder: "derivative2", smooth_window: 9, shape: "Pseudo-Voigt", bgDegree: 3, linkMode: "Shared FWHM", constrain: true,
};

describePresetAdapterContract({
  adapter,
  sample,
  wrongType: { field: "bg_iterative", value: "yes" },
  outOfRange: { field: "max_peaks", value: 0 },
});

describe("peaks adapter: Advanced fields the current finder or background hide", () => {
  it("are not value-checked and are never stored as a refused value", () => {
    expect(adapter.parse({ ...sample, bg_method: "snip", bg_poly_degree: -1 })).not.toHaveProperty("error");
    expect(adapter.parse({ ...sample, bg_method: "polynomial", max_window_deg: -2 })).not.toHaveProperty("error");
    expect(adapter.parse({ ...sample, finder: "residual", smooth_window: -5 })).not.toHaveProperty("error");
    expect(adapter.parse({ ...sample, bg_method: "polynomial", bg_poly_degree: -1 })).toMatchObject({ error: expect.stringContaining("'bg_poly_degree'") });
    state.draft = { ...DEFAULT_PEAK_FIND, bg_method: "snip", bg_poly_degree: -1, finder: "residual", smooth_window: -5 };
    const captured = adapter.capture();
    expect(captured).toMatchObject({ bg_poly_degree: DEFAULT_PEAK_FIND.bg_poly_degree, smooth_window: DEFAULT_PEAK_FIND.smooth_window });
    expect(adapter.parse(captured)).not.toHaveProperty("error");
    state.draft = { ...DEFAULT_PEAK_FIND };
  });
});

const KEY = "qz.peakRecipes";
const store = () => JSON.parse(localStorage.getItem(KEY) ?? "[]") as Record<string, unknown>[];
const backend = adapter.backend!;

beforeEach(() => localStorage.clear());

/** What the Peak analyzer would have saved, with distinctive baseline / range / fit-edit sections. */
const wizardRecipe = (name: string): PeakRecipe => ({
  ...DEFAULT_RECIPE, name, range: { lo: 10, hi: 80 },
  baseline: { ...DEFAULT_RECIPE.baseline, method: "snip" },
  find: { snr_threshold: 3, min_prominence: 0.03, max_peaks: 9, strict_prominence: true },
  model: { shape: "Gaussian", bgDegree: 2, linkMode: "None", constrain: false },
  report: { mode: "integrate", regionWidth: 4 },
  fit: { ...DEFAULT_RECIPE.fit, shareFwhm: true },
});

describe("peak recipes are this workshop's presets", () => {
  it("an existing recipe (v2, and v1 without a fit section) lists as an applicable preset", () => {
    const v1 = { ...wizardRecipe("Old v1"), version: 1 } as Record<string, unknown>;
    delete v1.fit;
    localStorage.setItem(KEY, JSON.stringify([wizardRecipe("Wizard"), v1]));
    const { entries } = backend.list();
    expect(entries.map((e) => [e.name, e.state])).toEqual([["Old v1", "ok"], ["Wizard", "ok"]]);
    const wiz = entries.find((e) => e.name === "Wizard");
    // Absent advanced find fields are the route's defaults; present ones are the recipe's.
    expect(wiz).toMatchObject({ settings: { ...DEFAULT_PEAK_FIND, snr_threshold: 3, min_prominence: 0.03, max_peaks: 9, strict_prominence: true, shape: "Gaussian", bgDegree: 2 } });
  });

  it("a preset saved from the bar is a valid peak recipe for the old path", () => {
    expect(backend.save("From bar", sample)).toEqual({ ok: true, id: "From bar", updated: false });
    const loaded = loadRecipesChecked();
    expect(loaded.warnings).toEqual([]);
    const recipe = loaded.recipes.find((r) => r.name === "From bar")!;
    expect(recipe).toMatchObject({ version: 2, find: expect.objectContaining({ sensitivity: "high", finder: "derivative2", max_peaks: 7 }), model: { shape: "Pseudo-Voigt", bgDegree: 3, linkMode: "Shared FWHM", constrain: true } });
    // It survives the recipe file round trip the Recipe Library offers.
    const out = exportNameKeyed("peak", "From bar");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    localStorage.setItem(KEY, "[]");
    expect(importNameKeyed("peak", out.text)).toMatchObject({ ok: true });
    expect(loadRecipes().find((r) => r.name === "From bar")).toMatchObject({ find: expect.objectContaining({ max_peaks: 7 }) });
    // And it lists back as the same settings.
    expect(backend.list().entries[0]).toMatchObject({ state: "ok", settings: sample });
  });

  it("saving over a wizard recipe replaces only find and model", () => {
    localStorage.setItem(KEY, JSON.stringify([wizardRecipe("Wizard")]));
    expect(backend.save("Wizard", sample)).toMatchObject({ ok: true, updated: true });
    const saved = store()[0] as unknown as PeakRecipe;
    expect(saved.range).toEqual({ lo: 10, hi: 80 });
    expect(saved.baseline.method).toBe("snip");
    expect(saved.report).toEqual({ mode: "integrate", regionWidth: 4 });
    expect(saved.fit.shareFwhm).toBe(true);
    expect(saved.find.max_peaks).toBe(7);
    expect(saved.model.shape).toBe("Pseudo-Voigt");
  });

  it("a newer-version or malformed recipe is listed locked or rejected, never applied, and survives other writes byte for byte", () => {
    const newer = { ...wizardRecipe("Newer"), version: 3, extra: { a: 1 } };
    const bad = { ...wizardRecipe("Bad fit"), fit: { engine: "nope" } };
    const foreign = { hello: "world" };
    localStorage.setItem(KEY, JSON.stringify([newer, bad, foreign]));
    const states = Object.fromEntries(backend.list().entries.map((e) => [e.name, e]));
    expect(states["Newer"]).toMatchObject({ state: "locked", reason: expect.stringContaining("newer version") });
    expect(states["Bad fit"]).toMatchObject({ state: "rejected" });
    expect(backend.save("Mine", sample)).toMatchObject({ ok: true });
    const after = store();
    expect(after.slice(0, 3)).toEqual([newer, bad, foreign]);
    expect(backend.save("Newer", sample)).toMatchObject({ ok: false, reason: expect.stringContaining("choose another name") });
    expect(backend.rename("Newer", "Renamed")).toMatchObject({ ok: false });
    expect(store().slice(0, 3)).toEqual([newer, bad, foreign]);
  });

  it("a recipe whose settings this version rejects is listed with the field named", () => {
    const r = wizardRecipe("Deep");
    r.model = { ...r.model, bgDegree: 9 };
    const withUnknown = { ...wizardRecipe("Unknown"), find: { ...wizardRecipe("x").find, mystery: 1 } };
    localStorage.setItem(KEY, JSON.stringify([r, withUnknown]));
    const states = Object.fromEntries(backend.list().entries.map((e) => [e.name, e]));
    expect(states["Deep"]).toMatchObject({ state: "rejected", reason: expect.stringContaining("'bgDegree'") });
    expect(states["Unknown"]).toMatchObject({ state: "rejected", reason: expect.stringContaining("'mystery'") });
  });

  it("rename and delete touch only that record", () => {
    localStorage.setItem(KEY, JSON.stringify([wizardRecipe("A"), wizardRecipe("B")]));
    expect(backend.rename("A", "B")).toMatchObject({ ok: false });
    expect(backend.rename("A", "C")).toEqual({ ok: true, id: "C", updated: true });
    expect(store().map((r) => r.name)).toEqual(["C", "B"]);
    expect(backend.remove("C")).toMatchObject({ ok: true });
    expect(store().map((r) => r.name)).toEqual(["B"]);
  });

  it("stores no dataset or row data", () => {
    backend.save("Clean", sample);
    expect(Object.keys(store()[0]!).sort()).toEqual(["baseline", "find", "fit", "model", "name", "range", "report", "version"]);
  });
});
