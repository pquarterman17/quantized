// Fitting graded (spline) layers (S2): the knots are fit parameters with the
// same vary/min/max/tie controls as slab fields, the request names the graded
// layers, and a saved fit keeps its graded model and fitted knots.

import { describe, expect, it } from "vitest";

import type { SldPreset } from "../../../lib/types";
import { parseWorkspace, serializeWorkspace } from "../../../lib/workspace";
import {
  applyBlockedReason,
  applyResults,
  buildParamRows,
  defaultBounds,
  resolveLayer,
  setLayerParam,
  toRequestParams,
  validateRows,
  type ParamOverrides,
} from "./reflFitModel";
import { decodeRecord, encodeRecord, recordsFor, REFL_FIT_RECORD_VERSION, withFitRecord, type ReflFitRecord } from "./reflFitRecord";
import { xrrDataset } from "./reflFit.testkit";
import { gradedFitBlock, gradedSpecs } from "./reflGraded";
import type { ModelLayer } from "./useReflectivity";

const PRESETS: SldPreset[] = [
  { name: "Air / Vacuum", formula: "", sldX: 0, sldN: 0, sldImag: 0, density: 0 },
  { name: "Silicon", formula: "Si", sldX: 2.007e-5, sldN: 2.073e-6, sldImag: 1e-7, density: 2.33 },
];

const GRADED: ModelLayer = {
  preset: "",
  thickness: 120,
  roughness: 4,
  sld: 3e-6,
  isld: 0,
  graded: { knots: [2e-6, 5e-6, 3e-6], method: "pchip" },
};
const STACK: ModelLayer[] = [
  { preset: "Air / Vacuum", thickness: 0, roughness: 0, sld: 0 },
  GRADED,
  { preset: "Silicon", thickness: 0, roughness: 3, sld: 0 },
];
const NONE: ParamOverrides = { layerCount: 3, byName: {} };
const GLOBALS = { scale: 1, background: 0 };

const rows = (over: ParamOverrides = NONE, stack = STACK) =>
  buildParamRows(stack.map((l) => resolveLayer(l, PRESETS, "neutron")), over, GLOBALS, false);

describe("graded layers in the parameter table", () => {
  it("offers the knots, thickness and roughness — never a slab SLD", () => {
    const names = rows().map((r) => r.name).filter((n) => n.startsWith("L1."));
    expect(names).toEqual(["L1.thickness", "L1.knot0.sld", "L1.knot1.sld", "L1.knot2.sld", "L1.roughness"]);
  });

  it("gives each knot the fixed/free flag and bounds a slab SLD has", () => {
    const knot = rows().find((r) => r.name === "L1.knot1.sld")!;
    // The same default bounds as a slab SLD of that value (`defaultBounds("sld", …)`).
    expect(knot).toMatchObject({ layer: 1, field: "sld", value: 5e-6, vary: false, tie: "" });
    expect([knot.min, knot.max]).toEqual(defaultBounds("sld", 5e-6));
    const over: ParamOverrides = { layerCount: 3, byName: { "L1.knot1.sld": { vary: true, min: 1e-6, max: 8e-6 } } };
    const set = rows(over).find((r) => r.name === "L1.knot1.sld")!;
    expect(set).toMatchObject({ vary: true, min: 1e-6, max: 8e-6 });
    expect(validateRows(rows(over))).toBeNull();
    const inverted = rows({ layerCount: 3, byName: { "L1.knot1.sld": { vary: true, min: 8e-6, max: 1e-6 } } });
    expect(validateRows(inverted)).toMatch(/L1\.knot1\.sld.*min < max/);
    expect(toRequestParams(rows(over)).find((p) => p.name === "L1.knot1.sld")).toEqual({
      name: "L1.knot1.sld", value: 5e-6, vary: true, min: 1e-6, max: 8e-6, tie: null,
    });
  });

  it("names the graded layers for the request at the Model mode's slab count", () => {
    expect(gradedSpecs(STACK)).toEqual([{ layer: 1, method: "pchip", slices: 60 }]);
    expect(gradedSpecs(STACK.map((l) => ({ ...l, graded: undefined })))).toEqual([]);
    // An end row is never graded, whatever it carries.
    expect(gradedSpecs([{ ...GRADED }, STACK[2]])).toEqual([]);
  });

  it("blocks only a graded layer the fit cannot slice", () => {
    expect(gradedFitBlock(STACK)).toBeNull();
    const flat = STACK.map((l, i) => (i === 1 ? { ...l, thickness: 0 } : l));
    expect(gradedFitBlock(flat)).toBe("Graded layer 1 needs a thickness above 0 Å to fit.");
  });
});

describe("knot values back into the model", () => {
  it("edits one knot in place", () => {
    const out = setLayerParam(STACK, PRESETS, "neutron", "L1.knot1.sld", 6e-6);
    expect(out[1].graded).toEqual({ knots: [2e-6, 6e-6, 3e-6], method: "pchip" });
    expect(out[0]).toBe(STACK[0]);
    // A knot the layer does not have changes nothing.
    expect(setLayerParam(STACK, PRESETS, "neutron", "L1.knot7.sld", 1e-6)).toEqual(STACK);
  });

  it("applies fitted knots and thickness", () => {
    const out = applyResults(STACK, PRESETS, "neutron", [
      { name: "L1.knot0.sld", value: 2.1e-6 },
      { name: "L1.knot2.sld", value: 3.3e-6 },
      { name: "L1.thickness", value: 118 },
    ]);
    expect(out[1]).toMatchObject({ thickness: 118, graded: { knots: [2.1e-6, 5e-6, 3.3e-6], method: "pchip" } });
  });

  it("refuses to apply onto a stack whose knot count changed", () => {
    const four = STACK.map((l, i) => (i === 1 ? { ...l, graded: { knots: [1, 2, 3, 4].map((k) => k * 1e-6), method: "pchip" as const } } : l));
    expect(applyBlockedReason({ layers: STACK, radiation: "neutron" }, STACK, "neutron")).toBeNull();
    expect(applyBlockedReason({ layers: STACK, radiation: "neutron" }, four, "neutron")).toMatch(/layer stack changed/);
  });
});

describe("a saved graded fit", () => {
  const record: ReflFitRecord = {
    version: REFL_FIT_RECORD_VERSION,
    id: "rfit-1",
    seq: 1,
    fittedAt: "2026-10-01T00:00:00.000Z",
    request: {
      parameters: toRequestParams(rows()),
      channels: [{
        datasetId: "xrr", rCol: 0, drCol: null, dqCol: null, dqIsFwhm: false, spin: "none",
        datasetName: "xrr.dat", rLabel: "R", drLabel: null, dqLabel: null, lambda: null, digest: "abc",
      }],
      settings: { xKind: "q", lambda: null, qMin: null, qMax: null, weighting: "dr", resolution: 0 },
      weighting: "dr",
      graded: gradedSpecs(STACK),
    },
    model: { layers: STACK, radiation: "neutron" },
    result: {
      parameters: [{ name: "L1.knot1.sld", value: 4.8e-6, stderr: 1e-8, vary: true, tie: null, at_bound: false }],
      free: ["L1.knot1.sld"],
      correlation: [[1]],
      chi2: 10, reduced_chi2: 1, sum_sq_log: null, reduced_sum_sq_log: null,
      n_points: 11, n_free: 1, success: true, message: "", n_evaluations: 5, weighting: "dr", warnings: [],
      objective: { label: "reduced χ²", value: 1 },
    },
  };

  it("round-trips the graded model, the graded request and the fitted knots (.dwk)", () => {
    const back = decodeRecord(JSON.parse(JSON.stringify(encodeRecord(record))));
    expect(back?.model.layers[1].graded).toEqual({ knots: [2e-6, 5e-6, 3e-6], method: "pchip" });
    expect(back?.request.graded).toEqual([{ layer: 1, method: "pchip", slices: 60 }]);
    expect(back?.result.parameters[0]).toMatchObject({ name: "L1.knot1.sld", value: 4.8e-6 });
  });

  it("skips a record whose graded profile is malformed rather than reading it as a slab", () => {
    const stored = JSON.parse(JSON.stringify(encodeRecord(record)));
    stored.model.layers[1].graded = { knots: ["x"], method: "pchip" };
    expect(decodeRecord(stored)).toBeNull();
  });
});

// Absorption (imaginary-SLD) knots and custom knot positions.
const ABSORBING: ModelLayer = {
  ...GRADED,
  graded: { knots: [2e-6, 5e-6, 3e-6], method: "pchip", isld: [1e-8, 0, 2e-8], positions: [0, 0.3, 1] },
};
const ABS_STACK: ModelLayer[] = [STACK[0], ABSORBING, STACK[2]];
const absRows = (over: ParamOverrides = NONE) => rows(over, ABS_STACK);

describe("graded absorption knots in the fit", () => {
  it("offers an isld row per knot after the SLD knots, only when absorption is on", () => {
    const names = absRows().map((r) => r.name).filter((n) => n.startsWith("L1."));
    expect(names).toEqual([
      "L1.thickness",
      "L1.knot0.sld", "L1.knot1.sld", "L1.knot2.sld",
      "L1.knot0.isld", "L1.knot1.isld", "L1.knot2.isld",
      "L1.roughness",
    ]);
    expect(rows().some((r) => r.name.includes(".knot") && r.name.endsWith(".isld"))).toBe(false);
  });

  it("gives an isld knot an absorption's controls and bounds (never negative)", () => {
    const k = absRows().find((r) => r.name === "L1.knot1.isld")!;
    expect(k).toMatchObject({ layer: 1, field: "isld", value: 0, vary: false, tie: "" });
    expect([k.min, k.max]).toEqual(defaultBounds("isld", 0));
    expect(k.min).toBeGreaterThanOrEqual(0);
    const over: ParamOverrides = { layerCount: 3, byName: { "L1.knot2.isld": { vary: true, min: 0, max: 5e-8, tie: "" } } };
    expect(toRequestParams(absRows(over)).find((p) => p.name === "L1.knot2.isld")).toEqual({
      name: "L1.knot2.isld", value: 2e-8, vary: true, min: 0, max: 5e-8, tie: null,
    });
  });

  it("sends the custom positions in the graded spec", () => {
    expect(gradedSpecs(ABS_STACK)).toEqual([{ layer: 1, method: "pchip", slices: 60, positions: [0, 0.3, 1] }]);
  });

  it("edits and applies isld knots back into the model, keeping the positions", () => {
    const edited = setLayerParam(ABS_STACK, PRESETS, "neutron", "L1.knot1.isld", 4e-9);
    expect(edited[1].graded?.isld).toEqual([1e-8, 4e-9, 2e-8]);
    // An isld knot on a layer without absorption changes nothing.
    expect(setLayerParam(STACK, PRESETS, "neutron", "L1.knot0.isld", 1e-8)).toEqual(STACK);
    const out = applyResults(ABS_STACK, PRESETS, "neutron", [
      { name: "L1.knot0.isld", value: 1.5e-8 },
      { name: "L1.knot1.sld", value: 4.5e-6 },
    ]);
    expect(out[1].graded).toEqual({ knots: [2e-6, 4.5e-6, 3e-6], method: "pchip", isld: [1.5e-8, 0, 2e-8], positions: [0, 0.3, 1] });
  });

  it("refuses to apply once absorption or the knot positions changed since the fit", () => {
    expect(applyBlockedReason({ layers: STACK, radiation: "neutron" }, ABS_STACK, "neutron")).toMatch(/layer stack changed/);
    // Fitted knot values mean something only at the positions they were fitted at.
    const moved = ABS_STACK.map((l, i) => (i === 1 ? { ...l, graded: { ...l.graded!, positions: [0, 0.5, 1] } } : l));
    expect(applyBlockedReason({ layers: ABS_STACK, radiation: "neutron" }, moved, "neutron")).toMatch(/layer stack changed/);
    expect(applyBlockedReason({ layers: ABS_STACK, radiation: "neutron" }, ABS_STACK, "neutron")).toBeNull();
  });

  it("blocks a partial absorption profile before the fit runs", () => {
    const partial = ABS_STACK.map((l, i) => (i === 1 ? { ...l, graded: { ...l.graded!, isld: [1e-8, 0] } } : l));
    expect(gradedFitBlock(partial)).toBe("Layer 1 needs an absorption value for every knot or for none.");
  });
});

describe("a saved graded fit with absorption and custom positions", () => {
  const sent = toRequestParams(absRows());
  const record: ReflFitRecord = {
    version: REFL_FIT_RECORD_VERSION,
    id: "rfit-2",
    seq: 1,
    fittedAt: "2026-10-01T00:00:00.000Z",
    request: {
      parameters: sent,
      channels: [{
        datasetId: "xrr", rCol: 0, drCol: null, dqCol: null, dqIsFwhm: false, spin: "none",
        datasetName: "xrr.dat", rLabel: "R", drLabel: null, dqLabel: null, lambda: null, digest: "abc",
      }],
      settings: { xKind: "q", lambda: null, qMin: null, qMax: null, weighting: "dr", resolution: 0 },
      weighting: "dr",
      graded: gradedSpecs(ABS_STACK),
    },
    model: { layers: ABS_STACK, radiation: "neutron" },
    result: {
      parameters: [{ name: "L1.knot2.isld", value: 2.5e-8, stderr: 1e-9, vary: true, tie: null, at_bound: false }],
      free: ["L1.knot2.isld"],
      correlation: [[1]],
      chi2: 10, reduced_chi2: 1, sum_sq_log: null, reduced_sum_sq_log: null,
      n_points: 11, n_free: 1, success: true, message: "", n_evaluations: 5, weighting: "dr", warnings: [],
      objective: { label: "reduced χ²", value: 1 },
    },
  };

  it("keeps the isld knots and positions through a .dwk save and reopen", () => {
    const [reopened] = parseWorkspace(serializeWorkspace({ datasets: withFitRecord([xrrDataset("xrr")], record) })).datasets;
    const [back] = recordsFor(reopened);
    expect(back.model.layers[1].graded).toEqual(ABSORBING.graded);
    expect(back.request.graded).toEqual([{ layer: 1, method: "pchip", slices: 60, positions: [0, 0.3, 1] }]);
    expect(back.request.parameters.filter((p) => p.name.includes(".knot") && p.name.endsWith(".isld")).map((p) => p.value)).toEqual([1e-8, 0, 2e-8]);
    expect(back.result.parameters[0]).toMatchObject({ name: "L1.knot2.isld", value: 2.5e-8 });
  });

  it("skips a record whose positions or absorption knots are malformed", () => {
    const bad = (patch: (s: { model: { layers: { graded: Record<string, unknown> }[] }; request: { graded: Record<string, unknown>[] } }) => void) => {
      const stored = JSON.parse(JSON.stringify(encodeRecord(record)));
      patch(stored);
      return decodeRecord(stored);
    };
    expect(bad((s) => { s.model.layers[1].graded.positions = ["x"]; })).toBeNull();
    expect(bad((s) => { s.model.layers[1].graded.isld = "none"; })).toBeNull();
    expect(bad((s) => { s.request.graded[0].positions = [0, "y", 1]; })).toBeNull();
  });
});
