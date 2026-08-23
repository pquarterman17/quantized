// P1.3 plot recipes: schema + pure capture (plotRecipe.ts). Matching lives in
// plotRecipeMatch.test.ts; parse/sanitize lives in plotRecipeIO.test.ts.

import { describe, expect, it } from "vitest";

import { captureRecipe, classifyErrorRole, normalizeLabel, serializeRecipe, type PlotRecipe } from "./plotRecipe";
import { defaultPlotView, type PlotView } from "./plotview";
import type { Dataset } from "./types";

function xrdDataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: "d1",
    name: "xrd-scan.xy",
    data: {
      time: [0, 1, 2],
      values: [[10, 100, 1], [20, 200, 2], [30, 300, 3]],
      labels: ["2theta", "Intensity", "Ierr"],
      units: ["deg", "cps", "cps"],
      metadata: { technique: "xrd.powder" },
    },
    ...overrides,
  };
}

function view(overrides: Partial<PlotView> = {}): PlotView {
  return { ...defaultPlotView(), ...overrides };
}

describe("normalizeLabel", () => {
  it("folds case and collapses whitespace", () => {
    expect(normalizeLabel("  2Theta  ")).toBe("2theta");
    expect(normalizeLabel("Field  Strength")).toBe("field strength");
  });
});

describe("classifyErrorRole", () => {
  it("returns \"value\" for a channel with no matching binding", () => {
    expect(classifyErrorRole([], 0)).toBe("value");
  });

  it("classifies a channel per its binding's axis/side", () => {
    const bindings = [{ channel: 2, target: 1, axis: "y" as const, side: "both" as const }];
    expect(classifyErrorRole(bindings, 2)).toBe("error-y");
    expect(classifyErrorRole(bindings, 1)).toBe("value");
  });

  it("encodes the asymmetric +/- suffix", () => {
    const bindings = [{ channel: 3, target: 0, axis: "x" as const, side: "+" as const }];
    expect(classifyErrorRole(bindings, 3)).toBe("error-x+");
  });
});

describe("captureRecipe", () => {
  const ds = xrdDataset();
  const v = view({ xKey: 0, yKeys: [1], errKeys: { 1: 2 } });

  function capture(): PlotRecipe {
    return captureRecipe(ds, v, null, {
      id: "r1",
      name: "XRD standard",
      appVersion: "0.0.0-test",
      now: () => "2026-08-22T00:00:00.000Z",
    });
  }

  it("stamps identity, provenance, technique, and schema version", () => {
    const r = capture();
    expect(r.id).toBe("r1");
    expect(r.name).toBe("XRD standard");
    expect(r.description).toBe("");
    expect(r.createdAt).toBe("2026-08-22T00:00:00.000Z");
    expect(r.modifiedAt).toBe("2026-08-22T00:00:00.000Z");
    expect(r.schemaVersion).toBe(1);
    expect(r.provenance).toEqual({ sourceDatasetLabel: "xrd-scan.xy", appVersion: "0.0.0-test" });
    expect(r.technique).toBe("xrd.powder");
  });

  it("builds one signature entry per MAPPED channel only, never per raw index", () => {
    const r = capture();
    expect(r.signature).toEqual([
      { id: "x0", role: "x", label: "2theta", unit: "deg", errorRole: "value", aliases: [] },
      { id: "y0", role: "y", label: "Intensity", unit: "cps", errorRole: "value", aliases: [] },
      { id: "error0", role: "error", label: "Ierr", unit: "cps", errorRole: "error-y", aliases: [] },
    ]);
  });

  it("expresses the mapping against signature entry ids, not raw channel indices", () => {
    const r = capture();
    expect(r.mapping).toEqual({
      xId: "x0",
      yIds: ["y0"],
      y2Ids: [],
      groupId: null,
      facetId: null,
      errors: [{ channel: "error0", target: "y0", axis: "y", side: "both" }],
    });
  });

  it("a channel referenced only for a role NOT captured here (view.facetKey null) never gets an entry", () => {
    const r = captureRecipe(ds, view({ xKey: 0, yKeys: [1] }), null, { id: "r2", name: "n", appVersion: "0" });
    expect(r.mapping.facetId).toBeNull();
    expect(r.signature.some((e) => e.role === "facet")).toBe(false);
  });

  // F4.4 (review K4/K6): facetKey is a real `PlotView` field now, captured
  // straight off `view` -- symmetric with groupKey, no separate opt.
  it("captures group/facet channels off view.groupKey/view.facetKey when supplied", () => {
    const r = captureRecipe(
      ds,
      view({ xKey: 0, yKeys: [1], groupKey: 2, facetKey: 1 }),
      null,
      { id: "r3", name: "n", appVersion: "0" },
    );
    // groupKey (channel 2, "Ierr") registers as its own "group" entry even
    // though the SAME channel also happens to look like an error column by
    // label -- role is assigned by how the mapping actually uses it.
    expect(r.mapping.groupId).toBe("group0");
    expect(r.signature.find((e) => e.id === "group0")).toMatchObject({ role: "group", label: "Ierr" });
    // facetKey (channel 1) was ALREADY registered as "y0" by yKeys -- the
    // first-assigned role wins; facetId points at the existing entry rather
    // than minting a duplicate for the same channel.
    expect(r.mapping.facetId).toBe("y0");
  });

  // F4.4 (review K4): compositionKind reads the durable facetKey binding
  // when the ephemeral `composition` argument has nothing to say -- a
  // recipe saved after a focus switch (composition null, facetKey still
  // set) must not silently record compositionKind: null alongside a real
  // mapping.facetId.
  it("compositionKind falls back to \"facet\" from view.facetKey when composition is null", () => {
    const r = captureRecipe(ds, view({ xKey: 0, yKeys: [1], facetKey: 1 }), null, {
      id: "r3b", name: "n", appVersion: "0",
    });
    expect(r.visual.compositionKind).toBe("facet");
  });

  it("compositionKind stays null when neither composition nor facetKey say anything", () => {
    const r = captureRecipe(ds, view({ xKey: 0, yKeys: [1] }), null, { id: "r3c", name: "n", appVersion: "0" });
    expect(r.visual.compositionKind).toBeNull();
  });

  it("captures autoscale-vs-fixed range policy per axis", () => {
    const auto = captureRecipe(ds, view(), null, { id: "r4", name: "n", appVersion: "0" });
    expect(auto.visual.xRange).toEqual({ mode: "auto" });

    const fixed = captureRecipe(ds, view({ yLim: [0, 100], yStep: 10 }), null, { id: "r5", name: "n", appVersion: "0" });
    expect(fixed.visual.yRange).toEqual({ mode: "fixed", lim: [0, 100], step: 10 });
  });

  it("keys seriesStyles/seriesLabels/seriesOrder/hiddenChannels by signature entry id", () => {
    const styled = view({
      xKey: 0,
      yKeys: [1],
      seriesStyles: { 1: { color: "#ff0000" } },
      seriesLabels: { 1: "Peak A" },
      seriesOrder: [1],
      hiddenChannels: [1],
    });
    const r = captureRecipe(ds, styled, null, { id: "r6", name: "n", appVersion: "0" });
    expect(r.visual.seriesStyles).toEqual({ y0: { color: "#ff0000" } });
    expect(r.visual.seriesLabels).toEqual({ y0: "Peak A" });
    expect(r.visual.seriesOrder).toEqual(["y0"]);
    expect(r.visual.hiddenChannels).toEqual(["y0"]);
  });

  it("drops a style override for a channel the mapping never references", () => {
    const styled = view({ xKey: 0, yKeys: [1], seriesStyles: { 2: { color: "#00ff00" } } });
    const r = captureRecipe(ds, styled, null, { id: "r7", name: "n", appVersion: "0" });
    expect(r.visual.seriesStyles).toEqual({});
  });

  it("captures the mark, falling back to \"line\" when unset", () => {
    const r1 = captureRecipe(ds, view(), null, { id: "r8", name: "n", appVersion: "0" });
    expect(r1.visual.mark).toBe("line");
    const r2 = captureRecipe(ds, view(), null, { id: "r9", name: "n", appVersion: "0", mark: "scatter" });
    expect(r2.visual.mark).toBe("scatter");
  });

  it("captures decorations verbatim as their own group", () => {
    const decorated = view({
      annotations: [{ id: "a1", x: 1, y: 2, text: "peak" }],
      shapes: [{ id: "s1", kind: "line", x1: 0, y1: 0, x2: 1, y2: 1 }],
      regionShades: [{ id: "rs1", x1: 0, x2: 1, y1: 0, y2: 1, fill: "#123456" }],
    });
    const r = captureRecipe(ds, decorated, null, { id: "r10", name: "n", appVersion: "0" });
    expect(r.visual.decorations.annotations).toHaveLength(1);
    expect(r.visual.decorations.shapes).toHaveLength(1);
    expect(r.visual.decorations.regionShades).toHaveLength(1);
    // Independent copies -- mutating the source view after capture must not
    // reach back into the captured recipe.
    decorated.annotations[0].text = "mutated";
    expect(r.visual.decorations.annotations[0].text).toBe("peak");
  });

  it("captures seriesStyles as independent copies, not shared object references (finding 3)", () => {
    const style = { color: "#ff0000" };
    const styled = view({ xKey: 0, yKeys: [1], seriesStyles: { 1: style } });
    const r = captureRecipe(ds, styled, null, { id: "r10b", name: "n", appVersion: "0" });
    // Mutating the SOURCE style object after capture must not reach back
    // into the captured recipe -- the same isolation "captures decorations
    // verbatim" already pins for annotations, extended to seriesStyles.
    style.color = "mutated";
    expect(r.visual.seriesStyles.y0).toEqual({ color: "#ff0000" });
  });

  it("falls back to view.errKeys' legacy symmetric-Y projection when opts.errors is omitted", () => {
    const r = captureRecipe(ds, view({ xKey: 0, yKeys: [1], errKeys: { 1: 2 } }), null, {
      id: "r11",
      name: "n",
      appVersion: "0",
    });
    expect(r.mapping.errors).toEqual([{ channel: "error0", target: "y0", axis: "y", side: "both" }]);
  });

  it("prefers rich opts.errors over view.errKeys when both are supplied", () => {
    const r = captureRecipe(
      ds,
      view({ xKey: 0, yKeys: [1], errKeys: { 1: 2 } }),
      null,
      {
        id: "r12",
        name: "n",
        appVersion: "0",
        errors: [{ channel: 2, target: -1, axis: "x", side: "+" }],
      },
    );
    expect(r.mapping.errors).toEqual([{ channel: "error0", target: null, axis: "x", side: "+" }]);
    // Finding 1: `errorRole` classifies "Ierr" from the DATASET's own
    // label-based inference ("error-y", bound to the preceding "Intensity"
    // column) -- NOT from `opts.errors`' x-error-side-"+" claim about how
    // the view is currently pairing it. The two are independent: mapping
    // usage (asserted above) can freely disagree with dataset classification.
    expect(r.signature.find((e) => e.id === "error0")).toMatchObject({ errorRole: "error-y" });
  });

  it("captures which composition kind was active, or null for a plain plot", () => {
    const none = captureRecipe(ds, view(), null, { id: "r13", name: "n", appVersion: "0" });
    expect(none.visual.compositionKind).toBeNull();
    const spatial = captureRecipe(
      ds,
      view(),
      { kind: "spatial", panels: [] },
      { id: "r14", name: "n", appVersion: "0" },
    );
    expect(spatial.visual.compositionKind).toBe("spatial");
  });
});

describe("captureRecipe — errorRole reflects the DATASET's classification, not the view's usage (finding 1)", () => {
  it("an error-named column plotted as a plain Y series is still classified by the DATASET's inference", () => {
    // "Ierr" (ch 2) reads as an error column by label alone, but the view
    // plots it as an ordinary second Y series -- no errKeys pairing at all.
    const r = captureRecipe(xrdDataset(), view({ xKey: 0, yKeys: [1, 2] }), null, {
      id: "r",
      name: "n",
      appVersion: "0",
    });
    const ierr = r.signature.find((e) => e.label === "Ierr");
    expect(ierr).toBeDefined();
    // Mapping role reflects the VIEW's usage (plotted as data)...
    expect(ierr?.role).toBe("y");
    // ...but errorRole reflects the DATASET's own classification, which
    // disagrees -- the two are independent axes (see RecipeSignatureEntry's
    // doc). Getting this backwards (classifying from the view instead) is
    // exactly what broke the capture-then-resolve round trip in finding 1.
    expect(ierr?.errorRole).toBe("error-y");
  });

  it("a non-error-shaped column manually paired via errKeys is still classified as \"value\" by the dataset", () => {
    const ds = xrdDataset({
      data: { ...xrdDataset().data, labels: ["2theta", "Intensity", "Extra"] }, // "Extra" reads as plain data
    });
    // The view manually pairs "Extra" (ch 2) as Intensity's (ch 1) error bar.
    const r = captureRecipe(ds, view({ xKey: 0, yKeys: [1], errKeys: { 1: 2 } }), null, {
      id: "r",
      name: "n",
      appVersion: "0",
    });
    const extra = r.signature.find((e) => e.label === "Extra");
    expect(extra).toBeDefined();
    expect(extra?.role).toBe("error"); // mapping usage: bound as an error channel
    expect(extra?.errorRole).toBe("value"); // dataset classification: doesn't read as one
    // The view's actual pairing still round-trips through mapping.errors,
    // untouched by this fix.
    expect(r.mapping.errors).toEqual([{ channel: extra?.id, target: expect.any(String), axis: "y", side: "both" }]);
  });
});

describe("serializeRecipe", () => {
  it("produces pretty, diffable JSON that round-trips through JSON.parse", () => {
    const r = captureRecipe(xrdDataset(), view({ xKey: 0, yKeys: [1] }), null, {
      id: "r1",
      name: "n",
      appVersion: "0",
    });
    const text = serializeRecipe(r);
    expect(text).toContain("\n");
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual(r);
  });
});
