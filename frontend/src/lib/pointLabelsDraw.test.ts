import { describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import { drawPointLabels } from "./pointLabelsDraw";
import type { LabelLayout } from "./pointLabelText";

function fakePlot(show = true) {
  const texts: { text: string; fill: unknown }[] = [];
  const ctx = {
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
    font: "", textBaseline: "", fillStyle: "" as unknown,
    fillText(text: string) { texts.push({ text, fill: this.fillStyle }); },
  };
  const u = {
    ctx,
    bbox: { left: 0, top: 0, width: 200, height: 100 },
    series: [{}, { stroke: "#123456", show }],
    valToPos: (v: number) => v * 10,
  } as unknown as uPlot;
  return { u, texts };
}

const layout = (over: Partial<LabelLayout> = {}): LabelLayout => ({
  points: [{ x: 1, y: 2, text: "S-1", row: 0, ch: 4, s: 0 }, { x: 3, y: 4, text: "S-2", row: 1, ch: 9, s: 1 }],
  note: null,
  refusal: null,
  ...over,
});

describe("drawPointLabels", () => {
  it("draws each label in its curve's colour; a point whose curve is not plotted is skipped", () => {
    const { u, texts } = fakePlot();
    drawPointLabels(u, layout(), [4]); // channel 4 -> series 1; channel 9 is not plotted
    expect(texts).toEqual([{ text: "S-1", fill: "#123456" }]);
  });

  it("draws nothing for a legend-hidden curve, and nothing at all for an empty layout", () => {
    const hidden = fakePlot(false);
    drawPointLabels(hidden.u, layout(), [4]);
    expect(hidden.texts).toEqual([]);
    const empty = fakePlot();
    drawPointLabels(empty.u, { points: [], note: null, refusal: null }, [4]);
    expect(empty.u.ctx.save).not.toHaveBeenCalled();
  });

  it("prints the refusal or thinning message under the plot", () => {
    const refused = fakePlot();
    drawPointLabels(refused.u, layout({ points: [], refusal: "are not drawn on a waterfall" }), [4]);
    expect(refused.texts.map((t) => t.text)).toEqual(["Point labels are not drawn on a waterfall"]);
    const thinned = fakePlot();
    drawPointLabels(thinned.u, layout({ note: "1 of 2 labels drawn; 1 crowded label left out" }), [4]);
    expect(thinned.texts.map((t) => t.text)).toEqual(["S-1", "1 of 2 labels drawn; 1 crowded label left out"]);
  });
});
