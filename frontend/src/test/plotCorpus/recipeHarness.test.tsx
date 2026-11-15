// The plot-corpus recipe harness on a tiny dataset (no backend): each step
// reaches the export request the app would post, and a refused gallery tile is
// reported as the recipe's failure rather than exporting a stale figure.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../lib/types";
import { runSpecimen, type SpecimenIn } from "./recipeHarness";

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [
    [1, 10],
    [2, 20],
    [3, 15],
    [4, 30],
    [5, 25],
    [6, 40],
  ],
  labels: ["y1", "y2"],
  units: ["", ""],
  metadata: { x_column_name: "x" },
};

function specimen(steps: SpecimenIn["steps"], prelude: Partial<SpecimenIn["prelude"]> = {}): SpecimenIn {
  return {
    key: "t/tiny",
    steps,
    dataset: DATA,
    prelude: { designations: {}, excluded_rows: [], axis: {}, styles: [], ...prelude },
  };
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
  // No backend: every app request fails, so stat compute takes its offline path.
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
});

describe("plot corpus recipe harness", () => {
  it("a gallery Line recipe exports both columns with the styles the Series card set", async () => {
    const out = await runSpecimen(specimen([{ gallery: "line" }], { styles: [{ color: "#ff0000", width: 2 }] }), 0);
    expect(out.error).toBeUndefined();
    expect(out.route).toBe("figure");
    const spec = out.spec as { y_keys: number[]; series_styles: ({ color?: string; width?: number } | null)[] };
    expect(spec.y_keys).toEqual([0, 1]);
    expect(spec.series_styles[0]).toMatchObject({ color: "#ff0000", width: 2 });
  });

  it("a Series-card step mode and a log axis reach the request", async () => {
    const out = await runSpecimen(specimen([{ gallery: "line" }, { seriesMode: "step" }], { axis: { y: "log10" } }), 1);
    const spec = out.spec as { y_scale: string; series_styles: ({ step?: string } | null)[] };
    expect(spec.y_scale).toBe("log");
    expect(spec.series_styles[0]?.step).toBe("post");
  });

  it("plotOnly + colorBy plots one column coloured by the other", async () => {
    const out = await runSpecimen(specimen([{ gallery: "scatter" }, { plotOnly: 1 }, { colorBy: 1 }]), 2);
    const spec = out.spec as { y_keys: number[]; series_styles: ({ color_by?: number } | null)[] };
    expect(spec.y_keys).toEqual([0]);
    expect(spec.series_styles[0]?.color_by).toBe(1);
  });

  it("a refused gallery tile is the recipe's error, not a stale export", async () => {
    const out = await runSpecimen(specimen([{ gallery: "ternary" }]), 3);
    expect(out.spec).toBeUndefined();
    expect(out.error).toMatch(/gallery refused ternary: Needs three composition columns/);
  });

  it("the Plot > Ternary diagram command builds with the workshop's default picks", async () => {
    const out = await runSpecimen(specimen([{ command: "ternary" }]), 4);
    expect(out.route).toBe("ternary");
    expect((out.spec as { labels: string[] }).labels).toEqual(["y1", "y2", "x"]);
  });

  it("a gallery Box recipe exports through the mounted Stat Stage", async () => {
    const out = await runSpecimen(specimen([{ gallery: "box" }]), 5);
    expect(out.error).toBeUndefined();
    expect(out.route).toBe("statplot");
    const spec = out.spec as { kind: string; labels: string[]; data: number[][] };
    expect(spec.kind).toBe("box");
    expect(spec.labels).toEqual(["y1", "y2"]);
    expect(spec.data[0]).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
