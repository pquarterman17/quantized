import { describe, expect, it } from "vitest";

import type { StackSeed } from "../../../store/workshopFlags";
import { buildParamRows, resolveLayer } from "./reflFitModel";
import { SEED_ROUGHNESS_A, seededModelBlock, stackToModelLayers } from "./reflStackSeed";

const SEED: StackSeed = {
  label: "film stack",
  stack: [
    { name: "film", thicknessA: 200, sld: { xray: 4e-5, neutron: 2e-6, xrayAbs: 1e-6 } },
    { name: "substrate", thicknessA: null, sld: { xray: null, neutron: null, xrayAbs: null } },
  ],
};

describe("stackToModelLayers", () => {
  it("builds incident + stack in order, substrate last with no thickness", () => {
    const m = stackToModelLayers(SEED, "xray");
    expect(m).toHaveLength(3);
    expect(m[0].preset).toBe("Air / Vacuum");
    expect(m[1]).toMatchObject({ preset: "", thickness: 200, sld: 4e-5, isld: 1e-6, sldProbe: "xray" });
    expect(m[2]).toMatchObject({ thickness: 0, sld: 0, sldPending: true });
  });

  it("uses the neutron SLD (and no absorption) in neutron mode", () => {
    const m = stackToModelLayers(SEED, "neutron");
    expect(m[1]).toMatchObject({ sld: 2e-6, sldProbe: "neutron" });
    expect(m[1].isld).toBeUndefined();
  });

  it("leaves roughness at the workshop default and marks it to fit", () => {
    const m = stackToModelLayers(SEED, "xray");
    expect(SEED_ROUGHNESS_A).toBe(3);
    expect(m[1].roughness).toBe(3);
    const rows = buildParamRows(m.map((l) => resolveLayer(l, [], "xray")), { layerCount: 3, byName: {} }, { scale: 1, background: 0 }, false);
    expect(rows.find((r) => r.name === "L1.roughness")?.vary).toBe(true);
    expect(rows.find((r) => r.name === "L1.sld")?.vary).toBe(false);
  });
});

describe("seededModelBlock", () => {
  it("blocks a pending SLD until a material is chosen", () => {
    const m = stackToModelLayers(SEED, "xray");
    expect(seededModelBlock(m, "xray")).toMatch(/SLD not set for layer 2/);
    m[2] = { ...m[2], preset: "Silicon", sldPending: undefined };
    expect(seededModelBlock(m, "xray")).toBeNull();
  });

  it("blocks a seeded SLD under the other radiation", () => {
    const m = stackToModelLayers({ ...SEED, stack: [SEED.stack[0], { ...SEED.stack[1], sld: SEED.stack[0].sld }] }, "xray");
    expect(seededModelBlock(m, "xray")).toBeNull();
    expect(seededModelBlock(m, "neutron")).toMatch(/computed for xray/);
  });
});
