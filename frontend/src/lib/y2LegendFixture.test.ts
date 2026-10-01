// A secondary-axis figure's LEGEND, screen == export, pinned as a SHARED wire
// fixture (`tests/fixtures/wire/y2_legend.json`).
//
// The canvas legend lists every drawn series in display order, whichever Y
// axis it is on. The export wire always carries a `legend` override (the
// view's position/title, `figureViewOverrides.viewOverrides`), and that used
// to switch off the backend's combined-legend rebuild: the exported legend
// listed only the primary-axis series. This half pins, per case, the entries
// the canvas shows and the exact request the app sends for it; the backend
// half (`tests/test_export_y2_legend.py`) asserts the exported legend is that
// same list, in that order, with the same title.
//
// Regenerate only after a DELIBERATE rule change:
//   Y2_LEGEND_FIXTURE_WRITE=1 npx vitest run src/lib/y2LegendFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createFigureDocument, type FigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { defaultPlotView, type PlotView } from "./plotview";
import { projectScreen } from "./regressionMatrixLegs.testkit";
import { matrixDataset } from "./regressionMatrixFixtures.testkit";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "y2_legend.json",
);

interface Case {
  name: string;
  view: Partial<PlotView>;
  /** The legend entries the canvas shows, in order; null = no legend. */
  legend: string[] | null;
}

// Matrix channels: 0 Signal (au), 1 Reference (au), 8 Temp (K).
const CASES: Case[] = [
  { name: "y2 series after the primary", view: { yKeys: [0, 8], y2Keys: [8] }, legend: ["Signal (au)", "Temp (K)"] },
  { name: "y2 series first in display order", view: { yKeys: [8, 0], y2Keys: [8] }, legend: ["Temp (K)", "Signal (au)"] },
  {
    name: "legend title",
    view: { yKeys: [0, 8], y2Keys: [8], legendTitle: "Run 4" },
    legend: ["Signal (au)", "Temp (K)"],
  },
  {
    name: "a hidden primary series",
    view: { yKeys: [0, 1, 8], y2Keys: [8], hiddenChannels: [1] },
    legend: ["Signal (au)", "Temp (K)"],
  },
  {
    name: "a renamed y2 series",
    view: { yKeys: [0, 8], y2Keys: [8], seriesLabels: { 8: "T" } },
    legend: ["Signal (au)", "T"],
  },
  {
    name: "a free-placed legend",
    view: { yKeys: [0, 1, 8], y2Keys: [8], legendXY: [0.3, 0.4] },
    legend: ["Signal (au)", "Reference (au)", "Temp (K)"],
  },
  { name: "legend off", view: { yKeys: [0, 8], y2Keys: [8], showLegend: false }, legend: null },
];

function figure(c: Case): FigureDocument {
  const view: PlotView = { ...defaultPlotView(), legendPos: "nw", ...c.view };
  return createFigureDocument({ id: "w1", name: "Y2 legend", datasetId: "matrix-ds", view });
}

function request(c: Case) {
  return buildFigureSpecFromDocument(figure(c), matrixDataset(), "y2legend", { fmt: "svg" });
}

function fresh() {
  return {
    cases: CASES.map((c) => ({
      name: c.name,
      request: request(c),
      legend: c.legend,
      legend_title: c.view.legendTitle ?? null,
    })),
  };
}

describe("a y2 figure's legend lists every drawn series, screen == export", () => {
  it.each(CASES)("canvas: $name", (c) => {
    const screen = projectScreen(figure(c), matrixDataset());
    expect(screen.decor.legend.show).toBe(c.legend !== null);
    if (c.legend !== null) expect(screen.series.map((s) => s.label)).toEqual(c.legend);
    expect(screen.y2Positions.length).toBeGreaterThan(0);
  });

  it("every request carries a legend override and a real y2 split", () => {
    for (const c of CASES) {
      const spec = request(c);
      expect(spec.overrides?.legend).toBeDefined();
      expect(spec.y2_keys).toEqual([8]);
    }
  });

  it("matches the committed fixture the backend half reads", () => {
    const now = fresh();
    if (process.env.Y2_LEGEND_FIXTURE_WRITE) {
      writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`, "utf8");
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(now)));
  });
});
