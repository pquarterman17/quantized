// GUI_INTERACTION #12 Slice 1 — export-parity CONTRACT HARNESS, part 2.
//
// See `exportParity.test.ts`'s header for the full rationale (this suite IS
// the empirical "one canonical spec" definition Slice 2+ builds a real
// PlotSpec v2 schema against). That file covers matrix rows 1-4 (axis
// limits, labels, scales/steps/formats, series display); THIS file covers
// rows 5-8: the y2-split display-order regression, decor (annotations/
// shapes/legend/grid/spines/log ticks), the error-bar documented gap, and
// the two fail-closed pins (faceted stat export, xy facet-export reset).
//
// A THIRD real finding lives in this file (rows 1 and 2's findings are in
// the sibling file's header):
//   - Row 6: `ticks.minor` is derived from `st.xScale`/`st.yScale` only —
//     a log-scaled y2Scale never sets it, even though the secondary axis
//     itself renders log-scaled (`y2_scale` DOES reach the request). Pinned
//     with `it.fails`, but see that test's comment: the backend's twinx
//     path (`calc/figure_y2.py`'s `draw_secondary_axes`) explicitly skips
//     the override sweep for the secondary axes ("NO overrides sweep" in
//     its own docstring), so fixing the frontend gate alone would not yet
//     produce visible minor ticks — this is a joint frontend+backend gap,
//     left for a later slice, not silently patched here.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigure } from "./api";
import { runExportFigureCommand } from "./exportFigureCommand";
import { useApp } from "../store/useApp";
import type { Annotation, DataStruct, Dataset, Shape } from "./types";

vi.mock("./api", () => ({
  exportFigure: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../components/overlays/ParamDialog", () => ({
  askParams: vi.fn().mockResolvedValue({
    fmt: "pdf",
    style: "default",
    dpi: 300,
    title: "",
    x_label: "",
    y_label: "",
  }),
}));

// Same 4-channel shape as exportParity.test.ts's fixture (kept local — test
// files don't share fixtures across files in this repo's convention).
const DATA: DataStruct = {
  time: [0, 1, 2],
  values: [
    [1, 10, 100, 1000],
    [2, 20, 200, 2000],
    [3, 30, 300, 3000],
  ],
  labels: ["A", "B", "C", "D"],
  units: ["ua", "ub", "uc", "ud"],
  metadata: {},
};

function makeDataset(): Dataset {
  return { id: "d1", name: "scan.dat", data: DATA };
}

function baseline(): Record<string, unknown> {
  return {
    datasets: [makeDataset()],
    activeId: "d1",
    xScale: "linear",
    yScale: "linear",
    showGrid: true,
    showLegend: true,
    legendPos: "ne",
    legendXY: null,
    legendFrameXY: null,
    legendTitle: null,
    showAxisBox: false,
    xLim: null,
    yLim: null,
    xStep: null,
    yStep: null,
    xFmt: { mode: "auto", digits: 2 },
    yFmt: { mode: "auto", digits: 2 },
    plotTitle: "",
    xAxisLabel: "",
    yAxisLabel: "",
    xKey: null,
    yKeys: null,
    y2Keys: null,
    y2Lim: null,
    y2Scale: null,
    y2Step: null,
    y2AxisLabel: "",
    annotations: [],
    shapes: [],
    seriesStyles: {},
    seriesLabels: {},
    errKeys: {},
    seriesOrder: null,
    hiddenChannels: [],
    pageSetup: null,
    status: "",
  };
}

async function exportBody() {
  await runExportFigureCommand(useApp.getState);
  const calls = vi.mocked(exportFigure).mock.calls;
  return calls[calls.length - 1][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(exportFigure).mockResolvedValue(undefined);
  useApp.setState(baseline());
});

describe("5. y2 split — display-order regression (08b7066)", () => {
  it("y2_keys is the y2-tagged subset of the FULL y_keys list, in DISPLAY (plotted) order — not raw setter order", async () => {
    // seriesOrder puts channel 2 before channel 0 on screen; y2Keys is set
    // in the OPPOSITE (raw index) order [0, 2] — if the export ever fell
    // back to raw y2Keys order instead of re-deriving from the plotted
    // list, this would catch it.
    useApp.setState({
      yKeys: [0, 1, 2, 3],
      seriesOrder: [2, 0, 1, 3],
      y2Keys: [0, 2],
    });
    const body = await exportBody();
    expect(body.y_keys).toEqual([2, 0, 1, 3]); // full plotted list, display order
    expect(body.y2_keys).toEqual([2, 0]); // subset, DISPLAY order (2 before 0)
  });

  it("y2_keys is a SUBSET marker: y_keys is unchanged from a no-y2 export, never replaced", async () => {
    useApp.setState({ yKeys: [0, 1, 2], y2Keys: [1] });
    const body = await exportBody();
    expect(body.y_keys).toEqual([0, 1, 2]);
    expect(body.y2_keys).toEqual([1]);
  });
});

describe("6. Decor: annotations, shapes, legend, grid/spines, log ticks", () => {
  it("annotation text/x/y/size carry through; a page-anchored annotation carries anchor:'page'", async () => {
    const annotations: Annotation[] = [
      { id: "a1", x: 1, y: 2, text: "Tc", size: 18 },
      { id: "a2", x: 0.1, y: 0.9, text: "note", anchor: "page" },
    ];
    useApp.setState({ annotations });
    const body = await exportBody();
    expect(body.overrides?.annotations).toEqual([
      { x: 1, y: 2, text: "Tc", size: 18 },
      { x: 0.1, y: 0.9, text: "note", anchor: "page" },
    ]);
  });

  it("drawn shapes carry through with their style fields", async () => {
    const shapes: Shape[] = [
      { id: "s1", kind: "rect", x1: 0, y1: 0, x2: 1, y2: 1, stroke: "#f00", fill: "#0f0", opacity: 0.4, width: 2, dash: true },
    ];
    useApp.setState({ shapes });
    const body = await exportBody();
    expect(body.overrides?.shapes).toEqual([
      { kind: "rect", x1: 0, y1: 0, x2: 1, y2: 1, stroke: "#f00", fill: "#0f0", opacity: 0.4, width: 2, dash: true },
    ]);
  });

  it("a corner legendPos maps through legendPosToLoc", async () => {
    useApp.setState({ legendPos: "sw" });
    const body = await exportBody();
    expect(body.overrides?.legend).toEqual({ show: true, loc: "lower left" });
  });

  it("a free legendXY maps to loc:custom + anchor, carrying the legend title along", async () => {
    useApp.setState({ legendXY: [0.3, 0.7], legendTitle: "Nb/Au" });
    const body = await exportBody();
    expect(body.overrides?.legend).toEqual({
      show: true,
      loc: "custom",
      anchor: [0.3, 0.7],
      title: "Nb/Au",
    });
  });

  it("grid and axis-box spines mirror the live showGrid/showAxisBox", async () => {
    useApp.setState({ showGrid: false, showAxisBox: true });
    const body = await exportBody();
    expect(body.overrides).toMatchObject({ grid: false, spines: { top: true, right: true } });
  });

  it("a log primary xScale or yScale sets ticks.minor", async () => {
    useApp.setState({ xScale: "log" });
    const body = await exportBody();
    expect(body.overrides?.ticks).toEqual({ minor: true });
  });

  // REAL FINDING (see this file's header for the full context): the
  // live-overrides ticks.minor gate only inspects st.xScale/st.yScale, never
  // st.y2Scale, so a log-scaled secondary axis exports without minor ticks
  // even though its own y2_scale:"log" DOES reach the request.
  it.fails(
    "GAP: a log y2Scale should also set ticks.minor for the secondary axis (currently ignored — lib/exportFigureCommand.ts's liveViewOverrides only checks xScale/yScale)",
    async () => {
      useApp.setState({ y2Keys: [1], y2Scale: "log", xScale: "linear", yScale: "linear" });
      const body = await exportBody();
      expect(body.overrides?.ticks).toEqual({ minor: true });
    },
  );
});

describe("7. Error bars — documented gap", () => {
  // liveViewOverrides' own doc comment: "error-bar/region/ref-line concepts
  // remain unsupported here." Confirmed structurally too: FigureSpec
  // (lib/api.ts) has no err_keys/error_bars field at all, so there is
  // nothing for any override to populate. Booked as GUI_INTERACTION #12
  // Slice 4 ("the booked export residuals"). This test pins the CURRENT
  // (gap) behavior deliberately — it must FAIL, not silently start passing
  // by coincidence, the day error-bar export support actually lands, as a
  // reminder to update this pin alongside that feature.
  it("live errKeys never reach the export request (no err_keys field anywhere in the body)", async () => {
    useApp.setState({ errKeys: { 0: 1 } }); // channel 0's error rides in channel 1
    expect(useApp.getState().errKeys).toEqual({ 0: 1 }); // sanity: the live state IS set
    const body = await exportBody();
    expect(body).not.toHaveProperty("err_keys");
    expect(body).not.toHaveProperty("error_bars");
    expect(body.overrides ?? {}).not.toHaveProperty("err_keys");
  });
});

describe("8. Fail-closed documentation pins", () => {
  // 8a — faceted stat marks: useStatStage's "flat draw goes null while
  // drawFacets is set" shape (StatStage.tsx disables Export via `!st.draw`)
  // is already covered by useStatStage.test.ts's "faceted box: drawFacets
  // has one draw per finite facet level; the flat draw stays null" test,
  // extended with a comment referencing this harness rather than duplicated
  // here (per the task's own instruction to avoid a redundant second test
  // of the same hook state).

  // 8b — xy facet-export xKey/yKeys reset: `facetByColumn` (store/useApp.ts)
  // computes its panels from the LIVE xKey/yKeys when the target dataset is
  // already active (captured correctly — the facetPanels below really do
  // reflect the pre-facet selection), but then unconditionally calls
  // `setActive(datasetId)`, whose `focusedRebindPatch` -> `datasetViewDefaults`
  // resets xKey/yKeys to null REGARDLESS of whether the dataset was already
  // active (store/windows.ts has no "already this id" special case). A
  // subsequent export therefore silently reverts to the default dense-
  // channel set instead of what the facet grid is actually showing. Booked
  // in plans/GUI_INTERACTION_PLAN.md's #11 Completed note ("the xy family's
  // facet-export xKey/yKeys reset... ride #12's canonical-spec work") — this
  // pins the CURRENT (fallback) behavior as a known gap, not correct
  // behavior, so it must be revisited (not just re-asserted) when #12
  // Slice 4 lands.
  it("GAP: facetByColumn resets the live xKey/yKeys even when the SAME dataset stays active, so a post-facet export silently reverts to the default channel set", async () => {
    const facetData: DataStruct = {
      time: [0, 1, 2, 3],
      values: [
        [1, 10, 0],
        [2, 20, 0],
        [3, 30, 1],
        [4, 40, 1],
      ],
      labels: ["A", "B", "grp"],
      units: ["u", "v", ""],
      metadata: {},
    };
    useApp.setState({
      datasets: [{ id: "d1", name: "scan.dat", data: facetData }],
      xKey: 1,
      yKeys: [0],
    });
    expect(useApp.getState().xKey).toBe(1);
    expect(useApp.getState().yKeys).toEqual([0]);

    useApp.getState().facetByColumn("d1", 2); // facet by "grp" — d1 is already active
    expect(useApp.getState().facetPanels?.length).toBe(2); // 2 finite grp levels

    // The panels themselves DO carry the pre-facet selection (facetByColumn
    // reads xKey/yKeys before calling setActive) — it's the STORE's live
    // singleton fields that get clobbered afterward.
    expect(useApp.getState().xKey).toBeNull();
    expect(useApp.getState().yKeys).toBeNull();

    const body = await exportBody();
    expect(body.x_key).toBeUndefined(); // reverted to .time, not channel 1
    expect(body.y_keys).toEqual([0, 1, 2]); // default-dense fallback, not the pre-facet [0]
  });
});
