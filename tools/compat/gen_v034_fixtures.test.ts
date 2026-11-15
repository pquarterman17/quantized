// ONE-OFF GENERATOR, run against a `git archive v0.34.0` copy of frontend/
// (steps: frontend/src/lib/__fixtures__/workspace/README.md). Not part of any
// suite here: it imports v0.34.0 module paths, which this tree need not keep.
// Builds a v0.34.0 workspace with that release's OWN code (parseWorkspace of
// the frozen v4 fixture as the base state, then v0.34.0's plot-window,
// figure, pipeline, template and recipe helpers) and writes:
//   v4-0.34.0.dwk.json            serializeWorkspace(state), savedAt pinned
//   v4-0.34.0.expected.json       what v0.34.0 itself reads back from it
//   graphTemplates-0.34.0.json    raw localStorage "qz.graphTemplates" value
//   plotRecipe-0.34.0.json        exportRecipeFile(recipe) (a standalone file)
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { it } from "vitest";

import v4 from "./lib/__fixtures__/workspace/v4.dwk.json";
import { createFigureDocument } from "./lib/figureDocument";
import { loadGraphTemplates, saveGraphTemplate, type FigureDoc } from "./lib/figuredoc";
import { captureGraphFormat } from "./lib/graphFormat";
import { makeStep } from "./lib/pipelineStep";
import { parseRecipe } from "./lib/plotRecipeIO";
import { exportRecipeFile } from "./lib/plotRecipeStorage";
import { defaultPlotView, type PlotWindow } from "./lib/plotview";
import { sanitizePlotWindows } from "./lib/plotWindows";
import type { Dataset } from "./lib/types";
import { parseWorkspace, serializeWorkspace } from "./lib/workspace";

const OUT = process.env.GEN_OUT ?? ".";
const VIEWPORT = { width: 1600, height: 900 };
const SAVED_AT = "2026-11-14T12:00:00.000Z";

it("generates the v0.34.0 compatibility fixtures", () => {
  const base = parseWorkspace(JSON.stringify(v4), VIEWPORT);

  // An Origin-import-shaped dataset: three Y channels, Origin book metadata.
  const origin: Dataset = {
    id: "c",
    name: "Book1",
    data: {
      time: [10, 20, 30, 40, 50],
      values: [
        [1.0, 100, 0.10],
        [2.0, 90, 0.12],
        [2.5, 85, 0.11],
        [3.5, 70, 0.15],
        [5.0, 60, 0.13],
      ],
      labels: ["R1", "R2", "dR1"],
      units: ["ohm", "ohm", "ohm"],
      metadata: { source_format: "origin", origin_book: "Book1", origin_sheet: "Sheet1", x_column_name: "T" },
    },
    errorRoles: [{ channel: 2, target: 0, axis: "y", side: "both" }] as Dataset["errorRoles"],
    columnDesignations: { 2: "Y-error" } as Dataset["columnDesignations"],
  };

  const view = {
    ...defaultPlotView(),
    xKey: null,
    yKeys: [0, 1],
    y2Keys: [1],
    yScale: "linear" as const,
    yFmt: { mode: "auto" as const, digits: 2, minor: 1, ticks: "in" as const, breaks: [[2.6, 3.4]] as [number, number][] },
    xAxisLabel: "T (K)",
    yAxisLabel: "R1 (ohm)",
    y2AxisLabel: "R2 (ohm)",
    plotTitle: "Book1 graph",
    errKeys: { 0: 2 },
    seriesStyles: { 0: { color: "#d62728", width: 2, marker: true, markerShape: "square" as const, markerSize: 6 }, 1: { color: "#1f77b4", line: "dash" as const } },
    seriesLabels: { 0: "R1 sample" },
    refLines: [{ axis: "y" as const, value: 3 }] as unknown as PlotWindow["view"]["refLines"],
  };

  const editable = createFigureDocument({
    id: "figure-034",
    name: "Book1 with axis break",
    datasetId: "c",
    view,
    mark: "line+marker" as never,
    axisBreaks: { y: [[2.6, 3.4]] },
  });

  const rawWindow = {
    id: "w-034",
    kind: "plot",
    title: "Book1 graph",
    datasetId: "c",
    geometry: { x: 40, y: 40, w: 640, h: 480 },
    z: 1,
    winState: "normal",
    view,
    document: editable,
    bg: "default",
    linkGroup: null,
  };
  const plotWindows = sanitizePlotWindows([rawWindow], new Set(["a", "b", "c"]), VIEWPORT);
  if (plotWindows.length !== 1) throw new Error("v0.34.0 rejected the plot window");

  const savedFigure: FigureDoc = {
    id: "fd-034",
    name: "Saved figure (0.34)",
    datasetId: "c",
    live: true,
    config: {
      xKey: null,
      yKeys: [0, 1],
      xScale: "linear",
      yScale: "linear",
      title: "Book1 graph",
      xLabel: "T (K)",
      yLabel: "R (ohm)",
      style: "publication",
      fmt: "pdf",
      dpi: 300,
      overrides: null,
      seriesStyles: null,
    },
  };

  const fit = makeStep("fit", "Fit Gaussian", 'qz.fit("Gaussian")', { model: "Gaussian" });

  const state = {
    ...base,
    datasets: [...base.datasets, origin],
    plotWindows,
    focusedWindowId: "w-034",
    figureDocs: [savedFigure],
    editableFigures: [...(base.editableFigures ?? []), editable],
    macroSteps: [...(base.macroSteps ?? []), fit],
  };
  const doc = JSON.parse(serializeWorkspace(state)) as Record<string, unknown>;
  doc.savedAt = SAVED_AT;
  const dwkText = JSON.stringify(doc, null, 1);
  writeFileSync(join(OUT, "v4-0.34.0.dwk.json"), dwkText + "\n");

  const readBack = parseWorkspace(dwkText, VIEWPORT);

  // Graph template exactly as v0.34.0 stores it in localStorage.
  localStorage.removeItem("qz.graphTemplates");
  saveGraphTemplate({
    name: "Book1 style (0.34)",
    style: "publication",
    overrides: null,
    seriesStyles: [{ color: "#d62728", linewidth: 2, marker: "s" } as never, null],
    format: captureGraphFormat(view, [0, 1]),
  });
  const templatesRaw = localStorage.getItem("qz.graphTemplates") ?? "[]";
  writeFileSync(join(OUT, "graphTemplates-0.34.0.json"), JSON.stringify(JSON.parse(templatesRaw), null, 1) + "\n");

  const recipe = readBack.plotRecipes?.[0];
  if (!recipe) throw new Error("no recipe in the base state");
  const recipeText = exportRecipeFile(recipe);
  writeFileSync(join(OUT, "plotRecipe-0.34.0.json"), recipeText + (recipeText.endsWith("\n") ? "" : "\n"));

  const expected = {
    workspace: readBack,
    graphTemplates: loadGraphTemplates(),
    recipe: parseRecipe(recipeText),
  };
  writeFileSync(join(OUT, "v4-0.34.0.expected.json"), JSON.stringify(expected, null, 1) + "\n");
});
