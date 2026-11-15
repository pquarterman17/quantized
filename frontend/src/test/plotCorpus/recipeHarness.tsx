// ORIGIN_PLOT_TYPE_PARITY_PLAN item 3: replay a "build this plot type from
// scratch" recipe against the REAL store, gallery and export builders, and
// return the export request the app would post for it.
//
// Test-only (nothing in the app imports it). The recipe table itself lives in
// tools/plot_corpus/scratch_recipes.py; this module only knows how to perform
// each step the way the UI performs it:
//
//   gallery     figureDialogActions.applyPlotType (Plot > Plot type...)
//   seriesMode  the Series card's trace-mode patch (lib/seriesMode)
//   waterfall   the Channels card waterfall slider (setWaterfall)
//   statMode    the Stat Stage plot-type picker (store/statLevelOptions)
//   plotOnly    the Channels card (setYKeys)
//   sizeBy / colorBy  the Series card mark-map controls (setSeriesStyle)
//   contour     the Map toolbar's contour toggle
//   command     a menu command (Plot > Ternary diagram...)
//
// The export request is built by the entry point the app's own Export command
// uses for what is on screen: `buildStageFigureSpec` for the XY / polar stage,
// the mounted <StatStage>'s registered exporter (`activeStatExporter`) for the
// Stat Stage, `fetchMap` + `mapFigureBody` for the Map tab, and the ternary
// workshop's `buildTernaryRequest` with its default picks.

import { act, render } from "@testing-library/react";

import { mapFigureBody } from "../../components/Stage/mapFigureExport";
import StatStage from "../../components/Stage/StatStage";
import { buildTernaryRequest } from "../../components/workshops/ternary/ternaryRequest";
import { defaultPicks } from "../../components/workshops/ternary/auxColumns";
import { applyPlotType } from "../../lib/figureDialogActions";
import { buildStageFigureSpec } from "../../lib/figureSpecStage";
import { defaultMapKeys, fetchMap, mapColumns } from "../../lib/mapdataFetch";
import { effectiveChannels } from "../../lib/plotdata";
import { plotTypeUnavailable, type PlotTypeId } from "../../lib/plotTypes";
import { analysisData } from "../../lib/rowstate";
import { seriesModePatch, type SeriesMode } from "../../lib/seriesMode";
import { activeStatExporter, type StatStageRequest } from "../../lib/statStageBridge";
import type { StatMode } from "../../lib/statstage";
import type { OriginDesignation } from "../../lib/columnmeta";
import type { Dataset, DataStruct, SeriesStyle } from "../../lib/types";
import { setColumnDesignation } from "../../store/columnDesignationActions";
import { setStatPicks } from "../../store/statLevelOptions";
import { useApp } from "../../store/useApp";

export type RecipeStep =
  | { gallery: PlotTypeId }
  | { seriesMode: SeriesMode }
  | { waterfall: number }
  | { statMode: StatMode }
  | { plotOnly: number }
  | { sizeBy: number }
  | { colorBy: number }
  | { contour: boolean }
  | { command: "ternary" };

export interface SpecimenIn {
  key: string;
  steps: RecipeStep[];
  dataset: DataStruct;
  prelude: {
    designations: Record<string, OriginDesignation>;
    excluded_rows: number[];
    axis: Record<string, string>;
    styles: Partial<SeriesStyle>[];
  };
}

export type ExportRoute = "figure" | "statplot" | "categorical" | "map" | "ternary";

export interface SpecimenOut {
  key: string;
  route?: ExportRoute;
  spec?: unknown;
  /** What the store holds after the recipe: enough to tell which renderer
   *  drew it without re-deriving the routing. */
  state?: { plotted: number[]; statMode: boolean; polarMode: boolean; stageTab: string; statPicks: unknown };
  error?: string;
}

const OPTS = { fmt: "png", style: "default", dpi: 100, title: "" };

/** The curves on screen: plotted channels minus columns Set As X (a sheet's
 *  second X is a per-series X, `lib/perSeriesX`, never a curve). */
function plotted(ds: Dataset): number[] {
  const s = useApp.getState();
  return effectiveChannels(ds.data, s.yKeys, s.xKey, ds.channelRoles, s.seriesOrder)
    .filter((ch) => ds.columnDesignations?.[ch] !== "X");
}

function activeDataset(): Dataset {
  const s = useApp.getState();
  const ds = s.datasets.find((d) => d.id === s.activeId);
  if (!ds) throw new Error("no active dataset");
  return ds;
}

/** The worksheet edits before a plot type is chosen (Set As, masks, log axes). */
function applyPrelude(id: string, p: SpecimenIn["prelude"]): void {
  for (const [ch, d] of Object.entries(p.designations)) setColumnDesignation(id, Number(ch), d);
  if (p.excluded_rows.length) useApp.getState().setRowsExcluded(id, p.excluded_rows);
  if (p.axis.x === "log10") useApp.getState().setXScale("log");
  if (p.axis.y === "log10") useApp.getState().setYScale("log");
}

function applyStep(step: RecipeStep, allY: number[], flags: { ternary: boolean }): void {
  const s = useApp.getState();
  const ds = activeDataset();
  if ("gallery" in step) {
    // A refused tile only sets a status (or nothing): surface it as the
    // recipe's failure instead of exporting whatever was on screen before.
    const refused = plotTypeUnavailable(step.gallery, ds);
    if (refused) throw new Error(`gallery refused ${step.gallery}: ${refused}`);
    applyPlotType(step.gallery, () => {
      flags.ternary = true;
    });
    const status = useApp.getState().status;
    if (!status.startsWith("plot type:")) throw new Error(`gallery refused ${step.gallery}: ${status}`);
  } else if ("command" in step) {
    flags.ternary = true; // Plot > Ternary diagram... opens the workshop (analysisCommands)
  } else if ("seriesMode" in step) {
    for (const ch of plotted(ds)) s.setSeriesStyle(ch, seriesModePatch(step.seriesMode, s.seriesStyles[ch] ?? {}));
  } else if ("waterfall" in step) {
    s.setWaterfall(step.waterfall);
  } else if ("statMode" in step) {
    const mode = step.statMode;
    setStatPicks((p) => ({ ...p, mode }));
  } else if ("plotOnly" in step) {
    s.setYKeys(allY.slice(0, step.plotOnly));
  } else if ("sizeBy" in step) {
    s.setSeriesStyle(plotted(ds)[0], { sizeBy: allY[step.sizeBy] });
  } else if ("colorBy" in step) {
    s.setSeriesStyle(plotted(ds)[0], { colorBy: allY[step.colorBy] });
  } else if ("contour" in step) {
    s.setContourOn(step.contour);
  }
}

async function statRequest(): Promise<StatStageRequest> {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<StatStage />);
  });
  try {
    let got: StatStageRequest | null = null;
    const exporter = activeStatExporter(useApp.getState());
    if (!exporter) throw new Error("no stat stage exporter registered");
    // The exporter waits for the stage's async compute to settle; let React
    // commit between polls (an act() around the whole await never commits).
    let done = false;
    let failure: unknown = null;
    exporter("png", {
      signal: new AbortController().signal,
      deliver: async (req) => {
        got = req;
      },
    }).then(() => { done = true; }, (err: unknown) => { failure = err; done = true; });
    for (let i = 0; i < 1500 && !done; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
    if (failure) throw failure instanceof Error ? failure : new Error(String(failure));
    if (!done) throw new Error("the stat stage never settled");
    if (!got) throw new Error("the stat stage exported nothing");
    return got;
  } finally {
    view.unmount();
  }
}

/** Replay one specimen's recipe from a fresh store; never throws. */
export async function runSpecimen(input: SpecimenIn, index: number): Promise<SpecimenOut> {
  useApp.setState(useApp.getInitialState(), true);
  const id = `corpus-${index}`;
  try {
    useApp.getState().addDataset({ id, name: `${input.key.replace("/", "_")}.csv`, data: input.dataset });
    applyPrelude(id, input.prelude);
    const ds0 = activeDataset();
    const allY = plotted(ds0);
    const flags = { ternary: false };
    for (const step of input.steps) applyStep(step, allY, flags);
    // The Series card styles the corpus set on Origin's curves, in curve order.
    const ds = activeDataset();
    const curves = plotted(ds);
    input.prelude.styles.forEach((st, i) => {
      if (i < curves.length) useApp.getState().setSeriesStyle(curves[i], st);
    });
    const s = useApp.getState();
    const state = {
      plotted: plotted(ds), statMode: s.statMode, polarMode: s.polarMode, stageTab: s.stageTab, statPicks: s.statPicks,
    };
    if (flags.ternary) {
      const data = analysisData(ds) as DataStruct;
      const [a, b, c] = defaultPicks(data, 3);
      const built = buildTernaryRequest(data, { a, b, c, colorBy: null }, { title: "", filename: "ternary" });
      return { key: input.key, route: "ternary", spec: built.spec, state };
    }
    if (s.stageTab === "map") {
      const data = mapColumns(ds.data);
      const [x, y, z] = defaultMapKeys(ds.data);
      const payload = await fetchMap(data, x, y, z, { method: s.mapMethod, nx: s.mapRes, ny: s.mapRes });
      const spec = mapFigureBody(
        payload,
        { cmap: "viridis", logZ: false, colorLimits: null, contour: { on: s.contourOn, levelCount: s.contourLevelCount, scale: s.contourScale } },
        { fmt: "png", style: "default", title: "", filename: "map" },
      );
      return { key: input.key, route: "map", spec, state };
    }
    if (s.statMode && !s.polarMode) {
      const req = await statRequest();
      return { key: input.key, route: req.route, spec: req.spec, state };
    }
    const spec = buildStageFigureSpec(useApp.getState, ds, "corpus", OPTS);
    return { key: input.key, route: "figure", spec, state };
  } catch (err) {
    return { key: input.key, error: err instanceof Error ? err.message : String(err) };
  }
}
