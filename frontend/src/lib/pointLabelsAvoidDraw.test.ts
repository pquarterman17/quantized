import { describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import { drawPointLabels } from "./pointLabelsDraw";
import type { LabelLayout } from "./pointLabelText";
import { DEFAULT_LABEL_AVOID } from "./pointLabelAvoid";

function fakePlot() {
  const drawn: { text: string; x: number; y: number }[] = [];
  const lines: number[][] = [];
  let from: number[] = [];
  const ctx = {
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), stroke: vi.fn(), setLineDash: vi.fn(),
    moveTo: (x: number, y: number) => { from = [x, y]; },
    lineTo: (x: number, y: number) => { lines.push([...from, x, y]); },
    measureText: (t: string) => ({ width: t.length * 6 }),
    font: "", textBaseline: "", fillStyle: "" as unknown, strokeStyle: "" as unknown, lineWidth: 1,
    fillText(text: string, x: number, y: number) { drawn.push({ text, x, y }); },
  };
  const u = {
    ctx, bbox: { left: 0, top: 0, width: 400, height: 300 },
    series: [{}, { stroke: "#123456", show: true, points: { size: 6 } }],
    valToPos: (v: number) => v * 10,
  } as unknown as uPlot;
  return { u, drawn, lines };
}

const cluster = (n: number): LabelLayout => ({
  points: Array.from({ length: n }, (_, i) => ({ x: 10 + i * 0.3, y: 15 - i * 0.2, text: `P${i + 1}-peak`, row: i, ch: 4, s: 0 })),
  note: null, refusal: null,
});
type Box = { l: number; t: number; r: number; b: number };
const boxes = (d: { text: string; x: number; y: number }[]): Box[] => d.map((p) => ({ l: p.x, t: p.y, r: p.x + p.text.length * 6, b: p.y + 11 * 1.2 }));
const apart = (a: Box, b: Box) => a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t;

describe("drawPointLabels with Avoid overlaps", () => {
  it("off (no `avoid`): every label sits up and right of its point, exactly as before", () => {
    const { u, drawn, lines } = fakePlot();
    drawPointLabels(u, cluster(2), [4]);
    expect(drawn.map(({ x, y }) => [x, y])).toEqual([[104, 146], [107, 144]]);
    expect(lines).toEqual([]);
  });

  it("a dense cluster comes out with no two label boxes touching, and far labels get leader lines", () => {
    const { u, drawn, lines } = fakePlot();
    drawPointLabels(u, { ...cluster(8), avoid: DEFAULT_LABEL_AVOID }, [4]);
    expect(drawn).toHaveLength(8);
    const b = boxes(drawn);
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) expect(apart(b[i], b[j])).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThan(8); // the first labels sit close: no leader
  });

  it("is deterministic, and a leader threshold above the plot size draws no leaders", () => {
    const a = fakePlot(), b = fakePlot(), c = fakePlot();
    drawPointLabels(a.u, { ...cluster(8), avoid: DEFAULT_LABEL_AVOID }, [4]);
    drawPointLabels(b.u, { ...cluster(8), avoid: DEFAULT_LABEL_AVOID }, [4]);
    drawPointLabels(c.u, { ...cluster(8), avoid: { ...DEFAULT_LABEL_AVOID, leaderDistance: 8 } }, [4]);
    expect(b.drawn).toEqual(a.drawn);
    expect(c.lines).toEqual([]);
  });

  it("a label with no room is still drawn, and the note counts it", () => {
    const { u, drawn } = fakePlot();
    (u as unknown as { bbox: object }).bbox = { left: 0, top: 0, width: 40, height: 20 };
    drawPointLabels(u, { ...cluster(1), avoid: DEFAULT_LABEL_AVOID }, [4]);
    expect(drawn.map((d) => d.text)).toEqual(["P1-peak", "1 label could not avoid overlap"]);
  });
});
