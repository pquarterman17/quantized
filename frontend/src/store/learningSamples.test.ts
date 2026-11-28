// The sample gallery's opens, through lib/learning/samples.ts and the real
// store: each sample lands its worksheet and its graph, as ONE undo step.
// The numbers shown are checked against independent computations.

import { beforeEach, describe, expect, it } from "vitest";

import { useAuxFigureStore } from "../components/workshops/ternary/auxFigureStore";
import { useApp } from "./useApp";
import { mapViewFor } from "../lib/mapView";
import { takeTernaryPicks } from "../lib/ternaryPending";
import { is2DMap } from "../lib/mapdata";
import * as data from "../lib/learning/sampleData";
import { MAX_BARS } from "../components/Stage/Map3D/sceneExt3d";
import { SAMPLES, openSample } from "./learningSamples";

const s = () => useApp.getState();
const active = () => s().datasets.find((d) => d.id === s().activeId)!;

beforeEach(() => {
  useApp.setState(useApp.getInitialState(), true);
  useAuxFigureStore.setState({ ternaryOpen: false });
});

describe("every sample opens and plots", () => {
  for (const sample of SAMPLES) {
    for (const mode of ["classic", "windows"] as const) {
      it(`${sample.id} (${mode}): one worksheet, one undo step, undo removes it`, async () => {
        useApp.setState({ layoutMode: mode });
        const before = s().history.length;
        const r = await openSample(sample.id);
        expect(r.ok).toBe(true);
        expect(s().datasets).toHaveLength(1);
        expect(active().name).toBe(sample.make().name);
        expect(s().history.length).toBe(before + 1);
        expect(s().history[s().history.length - 1]!.label).toBe(`open sample: ${sample.title}`);
        s().undo();
        expect(s().datasets).toHaveLength(0);
      });
    }
  }

  it("an unknown sample opens nothing", async () => {
    expect(await openSample("nope")).toEqual({ ok: false, reason: 'unknown sample "nope"' });
    expect(s().datasets).toHaveLength(0);
  });
});

describe("a map sample opens on a grid its 3-D bars can export", () => {
  for (const id of ["heatmap", "surface"]) {
    it(`${id}: the grid has at most ${MAX_BARS} cells (the default 200 x 200 had 40,000)`, async () => {
      expect(s().mapRes).toBe(200);
      expect((await openSample(id)).ok).toBe(true);
      expect(s().mapRes * s().mapRes).toBeLessThanOrEqual(MAX_BARS);
    });
  }
});

describe("a map sample opens only the map", () => {
  const shown = () => s().plotWindows.filter((w) => w.winState !== "minimized");
  for (const id of ["heatmap", "surface"]) {
    it(`${id} (window layout): one map window on screen, no line plot of Qx, Qz or Intensity beside it`, async () => {
      useApp.setState({ layoutMode: "windows" });
      expect((await openSample(id)).ok).toBe(true);
      expect(shown().map((w) => w.kind)).toEqual(["map"]);
      expect(shown()[0]!.datasetId).toBe(active().id);
    });
  }

  it("a pinned plot window of the user's own data stays untouched beside the new map", async () => {
    useApp.setState({ layoutMode: "windows" });
    await openSample("decay");
    const own = s().plotWindows.find((w) => w.kind === "plot")!;
    useApp.setState({ plotWindows: s().plotWindows.map((w) => (w.id === own.id ? { ...w, pinned: true } : w)) });
    await openSample("heatmap");
    const mapId = s().datasets.find((d) => d.name === "sample-map.dat")!.id;
    expect(shown().map((w) => [w.kind, w.datasetId])).toEqual([["plot", own.datasetId], ["map", mapId]]);
    expect(s().plotWindows.find((w) => w.id === own.id)?.datasetId).toBe(own.datasetId);
  });
});

describe("each family reaches its graph", () => {
  it("error bars: the Signal err column is bound as the Y error", async () => {
    await openSample("decay");
    const roles = active().errorRoles ?? [];
    expect(roles.some((b) => b.axis === "y" && b.channel === 1 && b.target === 0)).toBe(true);
  });

  it("statistics: the stat view is on, seeded with the Group and Response columns", async () => {
    await openSample("groups");
    expect(s().statMode).toBe(true);
    expect(s().statStageSeed).toMatchObject({ mode: "violin", groupCol: 0, valueCol: 1 });
    expect(active().data.cat_levels?.[0]).toEqual(["Control", "Dose A", "Dose B"]);
  });

  it("heat map: a flagged 2-D map, with a map window in windows mode", async () => {
    useApp.setState({ layoutMode: "windows" });
    await openSample("heatmap");
    expect(is2DMap(active().data)).toBe(true);
    expect(s().plotWindows.some((w) => w.kind === "map" && w.datasetId === s().activeId)).toBe(true);
  });

  it("heat map in classic mode lands on the Map tab", async () => {
    useApp.setState({ layoutMode: "classic" });
    await openSample("heatmap");
    expect(s().stageTab).toBe("map");
  });

  it("fit: Response and Fit on Y, Residual on Y2, markers on the data", async () => {
    await openSample("fit");
    expect(s().yKeys).toEqual([0, 1]);
    expect(s().y2Keys).toEqual([2]);
    expect(s().seriesStyles[0]).toMatchObject({ marker: true });
  });

  it("ternary: the ternary dialog opens on the worksheet", async () => {
    await openSample("ternary");
    expect(useAuxFigureStore.getState().ternaryOpen).toBe(true);
    expect(takeTernaryPicks(s().activeId)).toMatchObject({ a: 0, b: 1, c: 2 });
  });

  it("surface: the map is switched to its 3-D surface view", async () => {
    await openSample("surface");
    expect(mapViewFor(s().mapViews, s().activeId!).view3d).toMatchObject({ kind: "surface" });
  });
});

describe("generated values are right", () => {
  it("is deterministic: the same numbers on every open", () => {
    expect(data.decayWithErrors()).toEqual(data.decayWithErrors());
    expect(data.fitWithResiduals()).toEqual(data.fitWithResiduals());
  });

  it("the quadratic fit solves the normal equations (an exact quadratic is recovered)", () => {
    const x = [0, 1, 2, 3, 4, 5, 6];
    const y = x.map((v) => 2 - 3 * v + 0.5 * v * v);
    const [c0, c1, c2] = data.quadraticFit(x, y);
    expect(c0).toBeCloseTo(2, 9);
    expect(c1).toBeCloseTo(-3, 9);
    expect(c2).toBeCloseTo(0.5, 9);
  });

  it("residuals are data minus fit and orthogonal to 1, x and x^2 (the least-squares condition)", () => {
    const d = data.fitWithResiduals();
    const r = d.values.map((v) => v[2]!);
    const dot = (p: number) => d.time.reduce((a, x, i) => a + x ** p * r[i]!, 0);
    for (const p of [0, 1, 2]) expect(Math.abs(dot(p))).toBeLessThan(2e-4); // values rounded to 6 digits
    d.values.forEach((v) => expect(v[0]! - v[1]!).toBeCloseTo(v[2]!, 5));
  });

  it("ternary compositions sum to 100 wt%", () => {
    for (const v of data.ternaryComposition().values) expect(v[0]! + v[1]! + v[2]!).toBeCloseTo(100, 2);
  });

  it("the ripple surface matches sin(r)/r at a known point", () => {
    const d = data.rippleSurface();
    const row = d.values.find((v) => Math.abs(v[0]! - 1) < 1e-9 && Math.abs(v[1]! - 0) < 1e-9);
    if (row) expect(row[2]).toBeCloseTo(Math.sin(2.2) / 2.2, 5);
    expect(d.values.every((v) => Number.isFinite(v[2]!))).toBe(true);
  });

  it("the error column is a positive uncertainty", () => {
    for (const v of data.decayWithErrors().values) expect(v[1]!).toBeGreaterThan(0);
  });
});
