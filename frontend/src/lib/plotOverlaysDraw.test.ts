import { beforeEach, describe, expect, it, vi } from "vitest";

import { postJSON } from "./api/http";
import type { PlotPayload } from "./plotdata";
import { drawOverlays, fetchOverlays, overlayInputs, type OverlayResult } from "./plotOverlaysDraw";

vi.mock("./api/http", () => ({ postJSON: vi.fn() }));

const payload = (over: Partial<PlotPayload> = {}): PlotPayload => ({
  data: [[1, 2, 3], [1, 2, 3], [4, 5, 6], [7, 8, 9]] as unknown as PlotPayload["data"],
  series: [
    { label: "A", unit: "" },
    { label: "B (excluded)", unit: "", muted: true },
    { label: "fit", unit: "", overlay: true },
  ],
  xLabel: "x",
  xUnit: "",
  ...over,
});

describe("overlayInputs", () => {
  it("uses only real data curves (not companions, overlays, hidden or bars)", () => {
    const r = overlayInputs(payload(), undefined, undefined);
    expect(r).toMatchObject({ cols: [1], series: [{ label: "A" }] });
    expect(overlayInputs(payload(), [true, false, false], undefined)).toEqual({ refusal: expect.stringContaining("no plotted curve") });
    expect(overlayInputs(payload(), undefined, [{ bars: true }])).toEqual({ refusal: expect.stringContaining("no plotted curve") });
  });

  it("refuses a thinned, windowed, waterfall or categorical payload", () => {
    for (const over of [{ decimated: true }, { window: [0, 1] as [number, number] }, { yShift: [0, 1] }, { xCategories: ["a"] }]) {
      expect(overlayInputs(payload(over), undefined, undefined)).toHaveProperty("refusal");
    }
  });
});

describe("fetchOverlays", () => {
  beforeEach(() => vi.mocked(postJSON).mockReset());

  it("posts the shared x, each series and only the enabled overlays, and maps results to columns", async () => {
    vi.mocked(postJSON).mockResolvedValue({ series: [{ label: "A", refused: { line: "too few" } }] });
    const inputs = overlayInputs(payload(), undefined, undefined);
    if ("refusal" in inputs) throw new Error("unexpected");
    const out = await fetchOverlays(inputs, { line: null, smoother: null, ellipse: { level: 0.95 } });
    expect(postJSON).toHaveBeenCalledWith(
      "/api/plot/overlays",
      { x: [1, 2, 3], series: [{ label: "A", y: [1, 2, 3] }], overlays: { ellipse: { level: 0.95 } } },
      undefined,
    );
    expect(out).toEqual([{ col: 1, res: { label: "A", refused: { line: "too few" } } }]);
  });
});

describe("drawOverlays", () => {
  const fakePlot = () => {
    const texts: string[] = [];
    const ctx = new Proxy({ fillText: (t: string) => texts.push(t), measureText: () => ({ width: 50 }) } as Record<string, unknown>, {
      get: (t, k) => (k in t ? t[k as string] : () => undefined),
      set: (t, k, v) => ((t[k as string] = v), true),
    });
    const u = {
      ctx,
      bbox: { left: 0, top: 0, width: 400, height: 300 },
      series: [{}, { stroke: "#123456" }],
      valToPos: (v: number) => v * 10,
    };
    return { u: u as never, texts };
  };
  const res = (extra: Partial<OverlayResult["res"]>): OverlayResult[] => [{ col: 1, res: { label: "A", refused: {}, ...extra } }];

  beforeEach(() => {
    (globalThis as unknown as { Path2D: unknown }).Path2D = class {
      addPath() {}
      moveTo() {}
      lineTo() {}
      closePath() {}
    };
  });

  it("names each drawn overlay in the key", () => {
    const { u, texts } = fakePlot();
    drawOverlays(u, res({
      line: { x: [1, 2], y: [1, 2], label: "Line of fit: y = x", band: { lo: [0, 1], hi: [2, 3], label: "95% confidence band" } },
      smoother: { x: [1, 2], y: [1, 2], label: "LOWESS smoother" },
      ellipse: { x: [1, 2, 1], y: [1, 2, 3], label: "95% data ellipse" },
    }), null);
    expect(texts).toEqual(["95% confidence band", "Line of fit: y = x", "LOWESS smoother", "95% data ellipse"]);
  });

  it("fills a band as ONE closed polygon: lower edge out, upper edge back", () => {
    type Op = [string, ...number[]];
    class RecPath {
      ops: Op[];
      constructor(from?: RecPath) { this.ops = from ? [...from.ops] : []; }
      addPath(p: RecPath) { this.ops.push(...p.ops); }
      moveTo(x: number, y: number) { this.ops.push(["M", x, y]); }
      lineTo(x: number, y: number) { this.ops.push(["L", x, y]); }
      closePath() { this.ops.push(["Z"]); }
    }
    (globalThis as unknown as { Path2D: unknown }).Path2D = RecPath;
    const filled: RecPath[] = [];
    const { u } = fakePlot();
    (u as unknown as { ctx: { fill: (p: RecPath) => void } }).ctx.fill = (p) => filled.push(p);
    drawOverlays(u, res({ line: { x: [1, 2], y: [1, 2], label: "fit", band: { lo: [0, 1], hi: [2, 3], label: "band" } } }), null);
    expect(filled).toHaveLength(1);
    expect(filled[0]!.ops).toEqual([["M", 10, 0], ["L", 20, 10], ["L", 20, 30], ["L", 10, 20], ["Z"]]);
  });

  it("says why an overlay was refused instead of drawing it", () => {
    const { u, texts } = fakePlot();
    drawOverlays(u, res({ refused: { line: "a line of fit needs at least 3 points" } }), null);
    expect(texts).toEqual(["line not drawn: a line of fit needs at least 3 points"]);
    const second = fakePlot();
    drawOverlays(second.u, [], "not drawn on a waterfall");
    expect(second.texts).toEqual(["Overlays not drawn on a waterfall"]);
  });
});
