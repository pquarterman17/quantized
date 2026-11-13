// Fit templates (audit #15): stored as a one-fit-step analysis template (so
// the project file carries them through lib/templatesProject.ts), versioned,
// and sanitized on the way back — a malformed bag is "not a fit template",
// never a partial apply.

import { describe, expect, it } from "vitest";

import { fitTemplateOf, sanitizeFitTemplate, toFitTemplate, type FitTemplateSettings } from "./fitTemplates";
import { parseTemplate, serializeTemplate } from "./template";

const SETTINGS: FitTemplateSettings = {
  version: 1,
  model: "Exponential Decay",
  weight: "yerr",
  rows: [
    { name: "A", start: "3", min: "0", max: "", fixed: false },
    { name: "τ", start: "", min: "", max: "", fixed: false },
    { name: "C", start: "0.2", min: "", max: "", fixed: true },
  ],
  range: { lo: 0.5, hi: 9 },
};

describe("fit templates", () => {
  it("round-trips through the analysis-template file format", () => {
    const t = toFitTemplate("  decay  ", SETTINGS);
    expect(t.name).toBe("decay");
    expect(t.steps).toHaveLength(1);
    expect(t.steps[0]!.kind).toBe("fit");
    // Still a runnable pipeline fit step: model, weighting and range.
    expect(t.steps[0]!.params).toMatchObject({ model: "Exponential Decay", weight: { mode: "yerr" }, range: [0.5, 9] });
    const back = parseTemplate(serializeTemplate(t));
    expect(fitTemplateOf(back)).toEqual(SETTINGS);
  });

  it("keeps the manual weight column by LABEL", () => {
    const s = { ...SETTINGS, weight: "manual" as const, manualLabel: "dM" };
    expect(fitTemplateOf(toFitTemplate("m", s))).toEqual(s);
    expect(toFitTemplate("m", s).steps[0]!.params.weight).toBeUndefined();
  });

  it("keeps direct weighting (by column label) and unscaled errors", () => {
    const s = { ...SETTINGS, weight: "direct" as const, manualLabel: "w", scaleErrors: false as const };
    expect(fitTemplateOf(toFitTemplate("d", s))).toEqual(s);
    const y = { ...SETTINGS, scaleErrors: false as const };
    expect(toFitTemplate("y", y).steps[0]!.params.weight).toEqual({ mode: "yerr", scaleErrors: false });
    expect(sanitizeFitTemplate({ ...SETTINGS, scaleErrors: true })).toBeNull();
  });

  it.each([
    ["an unknown version", { ...SETTINGS, version: 2 }],
    ["an unknown weighting", { ...SETTINGS, weight: "chi" }],
    ["a row without a name", { ...SETTINGS, rows: [{ name: "", start: "", min: "", max: "", fixed: false }] }],
    ["a non-boolean hold", { ...SETTINGS, rows: [{ name: "A", start: "", min: "", max: "", fixed: "yes" }] }],
    ["an over-long value", { ...SETTINGS, rows: [{ name: "A", start: "1".repeat(65), min: "", max: "", fixed: false }] }],
    ["an inverted range", { ...SETTINGS, range: { lo: 5, hi: 1 } }],
    ["a non-finite range", { ...SETTINGS, range: { lo: 0, hi: null } }],
    ["too many rows", { ...SETTINGS, rows: Array.from({ length: 65 }, (_, i) => ({ name: `p${i}`, start: "", min: "", max: "", fixed: false })) }],
  ])("refuses %s", (_why, bag) => {
    expect(sanitizeFitTemplate(bag)).toBeNull();
  });

  it("is not a fit template unless it is exactly one fit step with valid settings", () => {
    const t = toFitTemplate("x", SETTINGS);
    expect(fitTemplateOf({ ...t, steps: [...t.steps, ...t.steps] })).toBeNull();
    expect(fitTemplateOf({ ...t, steps: [{ ...t.steps[0]!, params: { model: "Linear" } }] })).toBeNull();
    expect(() => toFitTemplate("y", { ...SETTINGS, model: "" })).toThrow();
  });
});
