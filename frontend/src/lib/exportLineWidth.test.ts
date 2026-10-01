// `exportLineWidth`: a line with no explicit width is named at the canvas'
// width. The end-to-end screen == export pin is `defaultTraceFixture.test.ts`
// (shared with the backend through `tests/fixtures/wire/default_trace.json`).

import { describe, expect, it } from "vitest";

import type { FigureSpec } from "./api/figures";
import { lineWidthSeriesStyles, withCanvasLineWidth } from "./exportLineWidth";
import { canvasLineWidth, DEFAULT_LINE_WIDTH_PX } from "./plotTemplates";

const DS = { time: [0, 1], values: [[1, 2], [3, 4]], labels: ["A", "B"], units: ["", ""], metadata: {} };
const spec = (extra: Partial<FigureSpec>): FigureSpec => ({ dataset: DS, y_keys: [0, 1], ...extra }) as FigureSpec;

describe("canvasLineWidth", () => {
  it("is the Preferences width under the Screen template, else the template's", () => {
    expect(canvasLineWidth("screen")).toBe(DEFAULT_LINE_WIDTH_PX);
    expect(canvasLineWidth("screen", 2.5)).toBe(2.5);
    expect(canvasLineWidth("nature", 2.5)).toBe(1.2);
    expect(canvasLineWidth("no-such-template")).toBe(DEFAULT_LINE_WIDTH_PX);
  });
});

describe("lineWidthSeriesStyles", () => {
  it("names the width on an unstyled or widthless entry, never an explicit one", () => {
    expect(lineWidthSeriesStyles([null, { color: "#123456" }, { width: 0, marker: true }, { width: 3 }], [0, 1, 2, 3], 1.5))
      .toEqual([{ width: 1.5 }, { color: "#123456", width: 1.5 }, { width: 0, marker: true }, { width: 3 }]);
  });

  it("leaves a lineless or colour-mapped entry alone, and fills a short list", () => {
    const none = { line: "none" as const };
    const mapped = { marker: true, color_by: 2, colormap: "viridis" };
    expect(lineWidthSeriesStyles([none, mapped], [0, 1, 2], 2)).toEqual([none, mapped, { width: 2 }]);
  });

  it("is a no-op without a width", () => {
    const styles = [null];
    expect(lineWidthSeriesStyles(styles, [0], undefined)).toBe(styles);
  });
});

describe("withCanvasLineWidth", () => {
  it("adds series_styles to a request that had none", () => {
    expect(withCanvasLineWidth(spec({}), 1.5).series_styles).toEqual([{ width: 1.5 }, { width: 1.5 }]);
  });

  it("widens every facet panel's series", () => {
    const facets = [{ title: "p", dataset: DS, series: [{ y: 0, style: null }, { y: 1, style: { width: 4 } }] }];
    const out = withCanvasLineWidth(spec({ facets } as unknown as Partial<FigureSpec>), 2);
    expect(out.facets?.[0].series.map((s) => s.style)).toEqual([{ width: 2 }, { width: 4 }]);
  });

  it("leaves a gradient encoding alone", () => {
    const s = spec({ encoding: { gradient_col: 1 } } as Partial<FigureSpec>);
    expect(withCanvasLineWidth(s, 1.5)).toBe(s);
  });
});
