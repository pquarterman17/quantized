import { describe, expect, it } from "vitest";

import type { SldPreset } from "../../../lib/types";
import {
  applyResults,
  buildParamRows,
  defaultBounds,
  formatNum,
  objectiveSummary,
  resolveLayer,
  setLayerParam,
  toRequestParams,
  validateRows,
  type ParamOverrides,
  type ResolvedLayer,
} from "./reflFitModel";
import type { ModelLayer } from "./useReflectivity";

const PRESETS: SldPreset[] = [
  { name: "Air / Vacuum", formula: "", sldX: 0, sldN: 0, sldImag: 0, density: 0 },
  { name: "Nickel", formula: "Ni", sldX: 7.18e-5, sldN: 9.4e-6, sldImag: 5e-7, density: 8.9 },
  { name: "Silicon", formula: "Si", sldX: 2.007e-5, sldN: 2.073e-6, sldImag: 1e-7, density: 2.33 },
];

const STACK: ModelLayer[] = [
  { preset: "Air / Vacuum", thickness: 0, roughness: 0, sld: 0 },
  { preset: "Nickel", thickness: 200, roughness: 5, sld: 0 },
  { preset: "Silicon", thickness: 0, roughness: 3, sld: 0 },
];

const NO_OVERRIDES: ParamOverrides = { layerCount: 3, byName: {} };
const GLOBALS = { scale: 1, background: 0 };

function resolved(radiation: "xray" | "neutron" = "xray"): ResolvedLayer[] {
  return STACK.map((l) => resolveLayer(l, PRESETS, radiation));
}

describe("buildParamRows", () => {
  it("offers only the fields that mean something, in the backend's canonical names", () => {
    const names = buildParamRows(resolved(), NO_OVERRIDES, GLOBALS, false).map((r) => r.name);
    expect(names).toEqual([
      "L0.sld",
      "L0.isld",
      "L1.thickness",
      "L1.sld",
      "L1.isld",
      "L1.roughness",
      "L2.sld",
      "L2.isld",
      "L2.roughness",
      "scale",
      "background",
    ]);
    // never the incident medium's thickness/roughness, nor the substrate's thickness
    for (const bad of ["L0.thickness", "L0.roughness", "L2.thickness"]) expect(names).not.toContain(bad);
    // unpolarised: no magnetic SLD at all (the backend refuses a varied msld without spin)
    expect(names.some((n) => n.endsWith(".msld"))).toBe(false);
  });

  it("adds msld for every layer but the incident medium only when a channel has a spin", () => {
    const names = buildParamRows(resolved("neutron"), NO_OVERRIDES, GLOBALS, true).map((r) => r.name);
    expect(names).toContain("L1.msld");
    expect(names).toContain("L2.msld");
    expect(names).not.toContain("L0.msld");
  });

  it("takes values from the resolved stack: X-ray SLD and POSITIVE absorption from the preset", () => {
    const rows = buildParamRows(resolved(), NO_OVERRIDES, GLOBALS, false);
    const get = (n: string) => rows.find((r) => r.name === n)!;
    expect(get("L1.sld").value).toBe(7.18e-5);
    expect(get("L1.isld").value).toBe(5e-7);
    expect(get("L1.thickness").value).toBe(200);
    expect(get("scale").value).toBe(1);
    expect(rows.every((r) => r.tie === "")).toBe(true);
    // Only the background varies by default (see `defaultVary`).
    expect(rows.filter((r) => r.vary).map((r) => r.name)).toEqual(["background"]);
  });

  it("varies the background by default inside its default bounds, and keeps scale fixed", () => {
    const rows = buildParamRows(resolved(), NO_OVERRIDES, GLOBALS, false);
    const bg = rows.find((r) => r.name === "background")!;
    const scale = rows.find((r) => r.name === "scale")!;
    expect(bg).toMatchObject({ vary: true, value: 0, min: 0, max: 1e-4 });
    expect(scale.vary).toBe(false);
    // A default table is fittable as-is: the varied background starts inside its bounds.
    expect(validateRows(rows)).toBeNull();
    // An explicit choice still wins over the default.
    const fixed = buildParamRows(resolved(), { layerCount: 3, byName: { background: { vary: false } } }, GLOBALS, false);
    expect(fixed.find((r) => r.name === "background")!.vary).toBe(false);
  });

  it("uses sensible default bounds", () => {
    expect(defaultBounds("thickness", 200)).toEqual([100, 300]);
    expect(defaultBounds("thickness", 0)).toEqual([0, 100]);
    expect(defaultBounds("roughness", 3)).toEqual([0, 15]);
    expect(defaultBounds("roughness", 10)).toEqual([0, 30]);
    expect(defaultBounds("sld", 2e-6)).toEqual([1e-6, 3e-6]);
    expect(defaultBounds("sld", 0)).toEqual([-1e-6, 1e-6]);
    expect(defaultBounds("isld", 0)).toEqual([0, 1e-6]); // absorption never negative
    expect(defaultBounds("scale", 1)).toEqual([0.5, 2]);
    expect(defaultBounds("background", 0)).toEqual([0, 1e-4]);
  });

  it("applies overrides only at the layer count they were made for", () => {
    const over: ParamOverrides = { layerCount: 3, byName: { "L1.thickness": { vary: true, min: 150 } } };
    const row = buildParamRows(resolved(), over, GLOBALS, false).find((r) => r.name === "L1.thickness")!;
    expect(row).toMatchObject({ vary: true, min: 150, max: 300 });
    const stale = { ...over, layerCount: 4 };
    const row2 = buildParamRows(resolved(), stale, GLOBALS, false).find((r) => r.name === "L1.thickness")!;
    expect(row2.vary).toBe(false);
  });

  it("drops a tie whose target is no longer offered", () => {
    const over: ParamOverrides = { layerCount: 3, byName: { "L2.sld": { tie: "L1.msld" } } };
    const row = buildParamRows(resolved(), over, GLOBALS, false).find((r) => r.name === "L2.sld")!;
    expect(row.tie).toBe("");
  });
});

describe("validateRows / toRequestParams", () => {
  it("refuses a varied parameter whose start lies outside its bounds, ignores fixed ones", () => {
    const rows = buildParamRows(resolved(), NO_OVERRIDES, GLOBALS, false);
    expect(validateRows(rows)).toBeNull();
    const bad = rows.map((r) => (r.name === "L1.thickness" ? { ...r, vary: true, min: 250, max: 300 } : r));
    expect(validateRows(bad)).toMatch(/L1\.thickness.*outside/);
    const inverted = rows.map((r) => (r.name === "scale" ? { ...r, vary: true, min: 2, max: 1 } : r));
    expect(validateRows(inverted)).toMatch(/scale.*min < max/);
  });

  it("serialises an empty tie as null", () => {
    const rows = buildParamRows(resolved(), NO_OVERRIDES, GLOBALS, false);
    const req = toRequestParams(rows);
    expect(req[0]).toEqual({ name: "L0.sld", value: 0, vary: false, min: -1e-6, max: 1e-6, tie: null });
  });
});

describe("setLayerParam / applyResults", () => {
  it("edits thickness/roughness in place and keeps the preset", () => {
    const out = setLayerParam(STACK, PRESETS, "xray", "L1.thickness", 210);
    expect(out[1]).toEqual({ ...STACK[1], thickness: 210 });
    expect(out[1].preset).toBe("Nickel");
  });

  it("turns a preset row into a manual row when its SLD is edited, keeping its absorption", () => {
    const out = setLayerParam(STACK, PRESETS, "xray", "L1.sld", 7e-5);
    expect(out[1]).toMatchObject({ preset: "", sld: 7e-5, isld: 5e-7, thickness: 200 });
  });

  it("writes fitted values back, switching a row to manual only when its SLD moved", () => {
    const params = [
      { name: "L1.thickness", value: 187.5 },
      { name: "L1.roughness", value: 4.2 },
      { name: "L1.sld", value: 7.18e-5 }, // unchanged → Nickel stays
      { name: "L1.isld", value: 5e-7 },
      { name: "L2.sld", value: 2.1e-5 }, // moved → manual
      { name: "L2.isld", value: 1e-7 },
      { name: "L2.roughness", value: 2.5 },
      { name: "scale", value: 0.98 },
    ];
    const out = applyResults(STACK, PRESETS, "xray", params);
    expect(out[1]).toMatchObject({ preset: "Nickel", thickness: 187.5, roughness: 4.2 });
    expect(out[2]).toMatchObject({ preset: "", sld: 2.1e-5, isld: 1e-7, roughness: 2.5 });
    // the result resolves to exactly the fitted values
    expect(resolveLayer(out[2], PRESETS, "xray")).toMatchObject({ sld: 2.1e-5, isld: 1e-7 });
    expect(out[0]).toBe(STACK[0]);
  });
});

describe("objectiveSummary", () => {
  it("labels dR weighting χ² and log weighting never χ²", () => {
    expect(objectiveSummary({ weighting: "dr", reduced_chi2: 1.2, reduced_sum_sq_log: null })).toEqual({
      label: "reduced χ²",
      value: 1.2,
    });
    const log = objectiveSummary({ weighting: "log", reduced_chi2: null, reduced_sum_sq_log: 0.003 });
    expect(log.value).toBe(0.003);
    expect(log.label).not.toMatch(/χ|chi/i);
  });

  it("formats numbers compactly and nulls as a dash", () => {
    expect(formatNum(null)).toBe("—");
    expect(formatNum(Number.NaN)).toBe("—");
    expect(formatNum(187.54321)).toBe("187.54");
    expect(formatNum(7.18e-5)).toBe("7.180e-5");
  });
});
