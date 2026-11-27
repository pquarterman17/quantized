import { describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import { drawPointLabels } from "./pointLabelsDraw";
import type { LabelLayout } from "./pointLabelText";
import { DEFAULT_LABEL_AVOID } from "./pointLabelAvoid";
import { labelMetrics } from "./pointLabelMetrics";

const M = labelMetrics(11); // the fake plot has no axes: ticks fall back to 11 px

function fakePlot() {
  const drawn: { text: string; x: number; y: number; align: string }[] = [];
  const lines: number[][] = [];
  let from: number[] = [];
  const ctx = {
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), stroke: vi.fn(), setLineDash: vi.fn(),
    moveTo: (x: number, y: number) => { from = [x, y]; },
    lineTo: (x: number, y: number) => { lines.push([...from, x, y]); },
    measureText: (t: string) => ({ width: t.length * 6 }),
    font: "", textBaseline: "", textAlign: "right", // uPlot leaves "right" behind after its axes fillStyle: "" as unknown, strokeStyle: "" as unknown, lineWidth: 1,
    fillText(text: string, x: number, y: number) { drawn.push({ text, x, y, align: this.textAlign }); },
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
const boxes = (d: { text: string; x: number; y: number }[]): Box[] => d.map((p) => ({ l: p.x, t: p.y, r: p.x + p.text.length * 6, b: p.y + M.h }));
const apart = (a: Box, b: Box) => a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t;

describe("drawPointLabels with Avoid overlaps", () => {
  it("off (no `avoid`): every label sits up and right of its point, exactly as before", () => {
    const { u, drawn, lines } = fakePlot();
    drawPointLabels(u, cluster(2), [4]);
    expect(drawn.map(({ x, y }) => [x, y])).toEqual([[100 + M.gap, 150 - M.gap], [103 + M.gap, 148 - M.gap]].map((p) => p.map((v) => expect.closeTo(v, 6))));
    expect(lines).toEqual([]);
  });

  it("draws every label and the note left-aligned, whatever alignment the axes left on the context", () => {
    const { u, drawn } = fakePlot();
    drawPointLabels(u, { ...cluster(8), note: "note", avoid: DEFAULT_LABEL_AVOID }, [4]);
    expect(drawn.length).toBeGreaterThan(8);
    expect(drawn.filter((d) => d.align !== "left")).toEqual([]); // right-aligned text sat a full width left of its placed box
  });

  it("keeps the placed labels off the note line at the bottom of the plot", () => {
    const { u, drawn } = fakePlot();
    // points near the bottom of the 300 px plot would otherwise land in the note's band
    const low: LabelLayout = { ...cluster(6), points: cluster(6).points.map((p) => ({ ...p, y: 27.5 })), note: "note", avoid: DEFAULT_LABEL_AVOID };
    drawPointLabels(u, low, [4]);
    const note = drawn.find((d) => d.text.startsWith("note"));
    expect(note).toBeDefined();
    for (const d of drawn.filter((x) => x !== note)) expect(d.y + 11 * 1.2).toBeLessThanOrEqual((note as { y: number }).y - 11 + 0.01); // the note's text rises 11 px above its baseline
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

  it("keeps labels off the legend box and draws leaders in a theme ink at least one pixel wide", () => {
    const base = fakePlot();
    drawPointLabels(base.u, { ...cluster(1), avoid: DEFAULT_LABEL_AVOID }, [4]);
    const [first] = base.drawn; // the default slot, up and right of the point
    const rect = (l: number, t: number, w: number, h: number) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h });
    const { u, drawn } = fakePlot();
    const legend = { getBoundingClientRect: () => rect(first.x - 5, first.y - 5, 60, 30) };
    Object.assign(u, {
      root: { closest: () => ({ querySelector: () => legend }) },
      over: { getBoundingClientRect: () => rect(0, 0, 400, 300) },
    });
    drawPointLabels(u, { ...cluster(1), avoid: DEFAULT_LABEL_AVOID }, [4]);
    const d = drawn[0];
    const hit = d.x < first.x + 55 && first.x - 5 < d.x + 7 * 6 && d.y < first.y + 25 && first.y - 5 < d.y + 13.2;
    expect(hit).toBe(false);
    // leaders: stroked in the token ink with a width of at least one pixel
    const probe = fakePlot();
    const ctx = probe.u.ctx as unknown as { lineWidth: number; strokeStyle: string };
    const widths: number[] = [];
    probe.u.ctx.stroke = () => { widths.push(ctx.lineWidth); };
    document.documentElement.style.setProperty("--text-dim", "rgb(9, 8, 7)");
    drawPointLabels(probe.u, { ...cluster(8), avoid: { ...DEFAULT_LABEL_AVOID, leaderWidth: 0.25 } }, [4]);
    expect(widths.length).toBeGreaterThan(0);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(1);
    expect(ctx.strokeStyle).toBe("rgb(9, 8, 7)");
  });

  it("a label with no room is still drawn, and the note counts it", () => {
    const { u, drawn } = fakePlot();
    (u as unknown as { bbox: object }).bbox = { left: 0, top: 0, width: 40, height: 20 };
    drawPointLabels(u, { ...cluster(1), avoid: DEFAULT_LABEL_AVOID }, [4]);
    expect(drawn.map((d) => d.text)).toEqual(["P1-peak", "1 label could not avoid overlap"]);
  });
});
