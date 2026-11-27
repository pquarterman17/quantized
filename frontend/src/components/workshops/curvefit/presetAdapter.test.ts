// Curve Fit's preset adapter over fit templates (PRESET_BAR_CONTRACT P2): the
// shared adapter contract, then both directions of coexistence with the old
// template code, and the backend's fail-closed behaviour.

import { beforeEach, describe, expect, it } from "vitest";

import { fitTemplateOf, toFitTemplate, type FitTemplateSettings } from "../../../lib/fitTemplates";
import { describePresetAdapterContract } from "../../../lib/presetAdapterContract.testkit";
import { loadIndex } from "../../../lib/recipeIndex";
import { loadTemplates, saveTemplate } from "../../../lib/template";
import { fromTemplateSettings, type CurveFitSettings } from "./curveFitSettings";
import { createCurveFitAdapter, type CurveFitPanelHandle } from "./presetAdapter";

/** A panel stand-in: holds one template, reports a skipped column the way the real binding does. */
function fakePanel(labels: string[] = ["y", "sigma"]) {
  let held: FitTemplateSettings = { version: 1, model: "Linear", weight: "none", rows: [] };
  const handle: CurveFitPanelHandle = {
    get current() { return held; },
    apply(t) {
      held = t;
      const gone = t.manualLabel !== undefined && !labels.includes(t.manualLabel);
      return { ok: true, skipped: gone ? [{ field: "manualLabel", reason: `column '${t.manualLabel}' is not on this sheet` }] : [] };
    },
  };
  return handle;
}

const SAMPLE: CurveFitSettings = {
  model: "Gaussian",
  weight: "manual",
  manualLabel: "sigma",
  scaleErrors: false,
  rows: [{ name: "amp", start: "3", min: "0", max: "10", fixed: false }, { name: "x0", start: "", min: "", max: "", fixed: true }],
  range: { lo: 1.5, hi: 9 },
};

beforeEach(() => localStorage.clear());

describePresetAdapterContract<CurveFitSettings>({
  adapter: createCurveFitAdapter(fakePanel()),
  sample: SAMPLE,
  wrongType: { field: "scaleErrors", value: "no" },
  outOfRange: { field: "range", value: { lo: 5, hi: 1 } },
  missingColumn: { settings: SAMPLE, field: "manualLabel", labels: ["y"], required: false },
});

describe("curve fit adapter: fit templates are the presets", () => {
  it("round-trips settings through the stored template shape", () => {
    const t = toFitTemplate("x", { version: 1, model: "Gaussian", weight: "manual", manualLabel: "sigma", scaleErrors: false, rows: SAMPLE.rows, range: { lo: 1.5, hi: 9 } });
    expect(fromTemplateSettings(fitTemplateOf(t)!)).toEqual(SAMPLE);
  });

  it("a template written by the old code is listed unchanged", () => {
    saveTemplate(toFitTemplate("legacy", { version: 1, model: "Gaussian", weight: "poisson", rows: [] }));
    const adapter = createCurveFitAdapter(fakePanel());
    const { entries } = adapter.backend!.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ state: "ok", name: "legacy", settings: { model: "Gaussian", weight: "poisson", manualLabel: "", scaleErrors: true, range: null } });
  });

  it("a preset saved from the bar is a record the old template code reads", () => {
    const adapter = createCurveFitAdapter(fakePanel());
    expect(adapter.backend!.save("from bar", SAMPLE)).toMatchObject({ ok: true, id: "from bar" });
    const stored = loadTemplates();
    expect(stored).toHaveLength(1);
    expect(fitTemplateOf(stored[0]!)).toEqual({ version: 1, model: "Gaussian", weight: "manual", manualLabel: "sigma", scaleErrors: false, rows: SAMPLE.rows, range: { lo: 1.5, hi: 9 } });
    // ... and it is still a runnable pipeline fit step.
    expect(stored[0]!.steps[0]).toMatchObject({ kind: "fit", params: { model: "Gaussian", range: [1.5, 9] } });
  });

  it("saving never rewrites a record it cannot read or that is not a fit template", () => {
    const foreign = { version: 1, name: "other tool", steps: [{ id: "", kind: "smooth", label: "s", code: "", params: {}, enabled: true }], outputs: [] };
    const newer = { version: 9, name: "from the future", steps: [] };
    localStorage.setItem("qz.analysisTemplates", JSON.stringify([foreign, newer]));
    const adapter = createCurveFitAdapter(fakePanel());
    expect(adapter.backend!.save("mine", SAMPLE).ok).toBe(true);
    const raw = JSON.parse(localStorage.getItem("qz.analysisTemplates")!) as unknown[];
    expect(raw[0]).toEqual(foreign);
    expect(raw[1]).toEqual(newer);
    expect(raw).toHaveLength(3);
    // A fit template may not overwrite a non-fit template of the same name.
    expect(adapter.backend!.save("other tool", SAMPLE)).toMatchObject({ ok: false, reason: expect.stringContaining("not a fit template") });
  });

  it("an unreadable store is reported and never written", () => {
    localStorage.setItem("qz.analysisTemplates", "{not json");
    const adapter = createCurveFitAdapter(fakePanel());
    expect(adapter.backend!.list().unreadable).toContain("untouched");
    expect(adapter.backend!.save("x", SAMPLE).ok).toBe(false);
    expect(localStorage.getItem("qz.analysisTemplates")).toBe("{not json");
  });

  it("lists a newer-version fit template locked, and a bad one rejected with the field named", () => {
    const base = toFitTemplate("t", { version: 1, model: "Linear", weight: "none", rows: [] });
    const withBag = (name: string, bag: unknown) => ({ ...base, name, steps: [{ ...base.steps[0]!, params: { ...base.steps[0]!.params, fitTemplate: bag } }] });
    localStorage.setItem("qz.analysisTemplates", JSON.stringify([
      withBag("future", { version: 2, model: "Linear", weight: "none", rows: [] }),
      withBag("extra", { version: 1, model: "Linear", weight: "none", rows: [], bogus: 1 }),
      withBag("badweight", { version: 1, model: "Linear", weight: "heavy", rows: [] }),
    ]));
    const byName = Object.fromEntries(createCurveFitAdapter(fakePanel()).backend!.list().entries.map((e) => [e.name, e]));
    expect(byName.future).toMatchObject({ state: "locked", reason: expect.stringContaining("newer version") });
    expect(byName.extra).toMatchObject({ state: "rejected", reason: expect.stringContaining("'bogus'") });
    expect(byName.badweight).toMatchObject({ state: "rejected", reason: expect.stringContaining("'weight'") });
    const adapter = createCurveFitAdapter(fakePanel());
    expect(adapter.backend!.save("future", SAMPLE)).toMatchObject({ ok: false, reason: expect.stringContaining("locked") });
    expect(adapter.backend!.rename("future", "z")).toMatchObject({ ok: false });
  });

  it("rename carries the favourites sidecar, refuses a clash, and delete drops the sidecar entry", () => {
    const adapter = createCurveFitAdapter(fakePanel());
    adapter.backend!.save("one", SAMPLE);
    adapter.backend!.save("two", SAMPLE);
    localStorage.setItem("qz.recipeIndex", JSON.stringify({ "analysis:global:one": { favorite: true, tags: ["keep"], useCount: 2, lastUsed: 5 } }));
    expect(adapter.backend!.rename("one", "two")).toMatchObject({ ok: false });
    expect(adapter.backend!.rename("one", "uno")).toMatchObject({ ok: true, id: "uno" });
    expect(loadTemplates().map((t) => t.name).sort()).toEqual(["two", "uno"]);
    const index = loadIndex();
    expect(index["analysis:global:uno"]?.favorite).toBe(true);
    expect(index["analysis:global:one"]).toBeUndefined();
    expect(adapter.backend!.remove("uno")).toMatchObject({ ok: true });
    expect(loadIndex()["analysis:global:uno"]).toBeUndefined();
    expect(loadTemplates().map((t) => t.name)).toEqual(["two"]);
  });

  it("apply reports a skipped column and applies the rest", () => {
    const adapter = createCurveFitAdapter(fakePanel(["y"]));
    const out = adapter.apply(SAMPLE);
    expect(out).toMatchObject({ ok: true, skipped: [{ field: "manualLabel", reason: expect.stringContaining("'sigma'") }] });
    if (out.ok) expect(out.applied).not.toContain("manualLabel");
  });
});
