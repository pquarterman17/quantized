// Cell values through the real map render path: the labels are the MEASURED
// cells, whatever Resolution the heatmap is regridded to. A 6 x 6 scan at the
// default 100 x 100 used to draw none (every display cell ~3 px, all skipped).
import { afterEach, describe, expect, it, vi } from "vitest";

import { nativeCellGrid } from "../../lib/cellLabelsNative";
import { buildMapColumns } from "../../lib/mapdataFetch";
import type { DataStruct } from "../../lib/types";
import { draw } from "./mapRender";

function scan(n: number): DataStruct {
  const values: number[][] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) values.push([i * 2, j * 2, 10 * j + i]);
  return { time: values.map((_, k) => k), values, labels: ["x", "y", "z"], units: ["", "", ""], metadata: {} } as unknown as DataStruct;
}

/** Every fillText the render makes, with the 2-D context otherwise inert. */
function texts(run: () => void): { text: string; x: number; y: number }[] {
  const out: { text: string; x: number; y: number }[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(t, prop) {
      if (prop in t) return t[prop as string];
      if (prop === "fillText") return (text: string, x: number, y: number) => out.push({ text, x, y });
      if (prop === "createLinearGradient") return () => ({ addColorStop: () => {} });
      if (prop === "createImageData") return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (prop === "measureText") return () => ({ width: 10 });
      return () => {};
    },
    set(t, prop, v) {
      t[prop as string] = v;
      return true;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as never);
  run();
  return out;
}

afterEach(() => vi.restoreAllMocks());

describe("cell values on a coarse scan shown on a fine display grid", () => {
  const ds = scan(6);
  const payload = buildMapColumns(ds, 0, 1, 2, 100, 100);
  const opts = { format: "fixed", precision: 0 } as const;
  const host = () => {
    const h = document.createElement("div");
    Object.defineProperty(h, "clientWidth", { value: 650 });
    Object.defineProperty(h, "clientHeight", { value: 450 });
    return h;
  };

  it("draws one label per measured cell at the default Resolution", () => {
    const native = nativeCellGrid(ds.values, [0, 1, 2]);
    expect(native).not.toBeNull();
    const withLabels = texts(() => draw(document.createElement("canvas"), host(), payload, "viridis", false, null, true, null, null, { ...opts, native }));
    vi.restoreAllMocks();
    const without = texts(() => draw(document.createElement("canvas"), host(), payload, "viridis", false));
    expect(payload.xAxis).toHaveLength(100);
    expect(withLabels.length - without.length).toBe(36);
  });

  it("without the measured cells the 100 x 100 display grid draws none (the old defect's shape)", () => {
    const withLabels = texts(() => draw(document.createElement("canvas"), host(), payload, "viridis", false, null, true, null, null, opts));
    vi.restoreAllMocks();
    const without = texts(() => draw(document.createElement("canvas"), host(), payload, "viridis", false));
    expect(withLabels.length).toBe(without.length);
  });
});
