// Silent-failure audit (2026-10-01): these browser-storage saves swallowed a
// refused write (quota full, storage blocked), so the item vanished on reload
// with no word. Each case forces the refusal and asserts the one-line warning.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deleteGraphTemplate, saveGraphTemplate } from "./figuredoc";
import { deleteCustomModel, saveCustomModel, type CustomFitModel } from "./fitmodels";
import { DEFAULT_RECIPE, deleteRecipe, saveRecipe } from "./peakwizard";
import { deleteTemplate, saveTemplate, toTemplate } from "./template";
import { useToasts } from "../store/toasts";

const model: CustomFitModel = {
  version: 1,
  name: "Decay",
  equation: "y = a*exp(-x/t) + c",
  params: ["a", "t", "c"],
  guesses: [2, 1.5, 0.5],
  lower: [0, 0, null],
  upper: [null, null, null],
};

function refuseWrites(): void {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("quota exceeded", "QuotaExceededError");
  });
}

const warnings = () =>
  useToasts.getState().toasts.filter((t) => t.msg.includes("won't survive a reload")).map((t) => t.msg);

beforeEach(() => {
  localStorage.clear();
  useToasts.setState({ toasts: [] });
});
afterEach(() => vi.restoreAllMocks());

describe("a refused browser-storage save warns instead of failing silently", () => {
  it.each([
    ["analysis template", () => saveTemplate(toTemplate("flow", [], [])), "analysis template"],
    ["analysis template delete", () => deleteTemplate("flow"), "analysis template"],
    ["graph template", () => saveGraphTemplate({ name: "web", style: "web", overrides: null, seriesStyles: null }), "graph template"],
    ["graph template delete", () => deleteGraphTemplate("web"), "graph template"],
    ["custom fit model", () => saveCustomModel(model), "custom fit model"],
    ["custom fit model delete", () => deleteCustomModel("Decay"), "custom fit model"],
    ["peak recipe", () => saveRecipe({ ...DEFAULT_RECIPE, name: "xrd" }), "peak recipe"],
    ["peak recipe delete", () => deleteRecipe("xrd"), "peak recipe"],
  ])("%s", (_label, act, noun) => {
    refuseWrites();
    expect(act).not.toThrow(); // the change still lands for this session
    const w = warnings();
    expect(w).toHaveLength(1);
    expect(w[0]).toContain(noun);
    expect(useToasts.getState().toasts[0].kind).toBe("danger");
  });

  it("stays quiet when the write succeeds", () => {
    saveTemplate(toTemplate("flow", [], []));
    saveGraphTemplate({ name: "web", style: "web", overrides: null, seriesStyles: null });
    saveCustomModel(model);
    saveRecipe({ ...DEFAULT_RECIPE, name: "xrd" });
    expect(warnings()).toEqual([]);
  });
});
