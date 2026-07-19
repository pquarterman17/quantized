// GUI_INTERACTION #12 Slice 1 — export-parity CONTRACT HARNESS, part 2.
//
// See `exportParity.test.ts`'s header for the full rationale (this suite IS
// the empirical "one canonical spec" definition Slice 2+ builds a real
// PlotSpec v2 schema against). That file covers matrix rows 1-4 (axis
// limits, labels, scales/steps/formats, series display); THIS file covers
// rows 5-8: the y2-split display-order regression, decor (annotations/
// shapes/legend/grid/spines/log ticks), the error-bar documented gap, and
// the fail-closed pins (faceted stat export, xy facet-export reset).
//
// Row 6 was a THIRD real finding (rows 1 and 2's findings are in the
// sibling file's header), now FIXED (GUI_INTERACTION #12 slice 4a):
//   - Row 6: `ticks.minor` used to be derived from `st.xScale`/`st.yScale`
//     only — a log-scaled y2Scale never set it, even though the secondary
//     axis itself renders log-scaled (`y2_scale` DOES reach the request).
//     This was a joint frontend+backend gap: the frontend gate
//     (`runExportFigureCommand`, folding a plotted log y2Scale into the
//     same `minorTicks` boolean via `gateY2Overrides`) is only half the
//     fix — the backend's twinx path (`calc/figure_y2.py`'s
//     `draw_secondary_axes`) still keeps its "NO overrides sweep" doctrine
//     for everything else, but now takes an explicit `minor_ticks: bool`
//     parameter and applies it to `ax2` the same way
//     `calc.figure_overrides._apply_overrides` applies it to the primary
//     axes (`render_with_secondary_axis` threads `ov["ticks"]["minor"]`
//     through, nothing more).
//
// 8b (xy facet-export xKey/yKeys reset) is ALSO now FIXED (GUI_INTERACTION
// #12 slice 4b): `store/windows.ts`'s `focusedRebindPatch` (the shared body
// of `setActive`/`rebindWindow`'s focused-target path) only spreads
// `datasetViewDefaults(ds)` — the xKey/yKeys/seriesStyles/… reset — when
// `id` is a GENUINE dataset switch (`s.activeId !== id`); re-activating the
// dataset that's already active (facetByColumn's trailing `setActive` call,
// among others) now leaves the live channel selection untouched.
//
// 8a (faceted stat export) is ALSO now FIXED (GUI_INTERACTION #12 slice
// 4b): `useStatStage.exportFigure` reads `drawFacets` (when set) instead of
// the flat `draw`, rebuilding a `facets[]` wire payload — box/violin facets
// carry each panel's raw finite-value groups (`FacetDraw.rawGroups`) PLUS
// that panel's own resolved mode (`FacetDraw.draw.mode`, per-slice degrade
// fidelity — a violin facet that independently fell back to box on screen
// exports as box); bar facets reuse `draw.data` directly. The backend
// (`calc.figure_facets.render_stat_facets_figure`/
// `render_categorical_facets_figure`) composes one small-multiples figure
// via the SAME ceil(sqrt(n)) grid the screen shows, reusing
// `figure_statplots`/`figure_categorical`'s own per-panel draw functions so
// a single facet matches that module's flat single-panel export exactly.
// `StatStage.tsx`'s Export button now enables on EITHER `draw` or
// `drawFacets`. Covered end-to-end in `useStatStage.test.ts`'s "faceted
// export" describe block (not duplicated here — that hook-level harness
// already exercises the request-assembly path this file's OWN 1-7 matrix
// covers for the xy family).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigure } from "./api";
import { facetPanelsOf } from "./composition";
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
    y2Fmt: null,
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

describe("5b. y2Fmt — independent secondary-axis tick format (GUI #12 finish, part A)", () => {
  it("inherit default (y2Fmt unset): y2_fmt mirrors the live yFmt, matching pre-y2Fmt behavior", async () => {
    useApp.setState({ y2Keys: [1], yFmt: { mode: "sci", digits: 2 } });
    const body = await exportBody();
    expect(body.y2_fmt).toEqual({ mode: "sci", digits: 2 });
  });

  it("an explicit y2Fmt overrides yFmt in the export request", async () => {
    useApp.setState({ y2Keys: [1], yFmt: { mode: "sci", digits: 2 }, y2Fmt: { mode: "fixed", digits: 1 } });
    const body = await exportBody();
    expect(body.y2_fmt).toEqual({ mode: "fixed", digits: 1 });
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

  // FIXED (see this file's header for the full context): the live-overrides
  // ticks.minor gate used to only inspect st.xScale/st.yScale, never
  // st.y2Scale, so a log-scaled secondary axis exported without minor ticks
  // even though its own y2_scale:"log" DOES reach the request.
  // runExportFigureCommand now folds a plotted log y2Scale into the same
  // gate (`gateY2Overrides`), applied once y2Plotted is known.
  it(
    "a log y2Scale also sets ticks.minor for the secondary axis",
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

describe("8. Formerly fail-closed, now FIXED (GUI_INTERACTION #12 slice 4b)", () => {
  // 8a — faceted stat marks: FIXED. useStatStage's "flat draw goes null
  // while drawFacets is set" shape (StatStage.tsx now enables Export via
  // `st.draw || st.drawFacets`) is exercised end-to-end in
  // useStatStage.test.ts's "faceted export" describe block (request
  // assembly, per-facet mode fidelity, bar/box/violin) — not duplicated
  // here, since this file's own request-assembly harness is for the xy
  // family (rows 1-7 above), not the Stat Stage's own hook-local exporter.

  // 8b — xy facet-export xKey/yKeys reset: FIXED (GUI_INTERACTION #12 slice
  // 4b). `facetByColumn` (store/useApp.ts) computes its panels from the LIVE
  // xKey/yKeys when the target dataset is already active (captured
  // correctly — the facetPanels below really do reflect the pre-facet
  // selection), then calls `setActive(datasetId)` to normalize window/tab
  // state. That call used to unconditionally reset xKey/yKeys to null via
  // `focusedRebindPatch` -> `datasetViewDefaults`, even though `datasetId`
  // was ALREADY active — `store/windows.ts` now only applies
  // `datasetViewDefaults` on a genuine dataset switch (`s.activeId !== id`),
  // so a same-id `setActive` (facetByColumn/breakAtGaps's trailing call, a
  // drag-drop re-target, …) leaves the live selection untouched. A
  // subsequent export therefore reflects what the facet grid is actually
  // showing, not the default dense-channel fallback. Was booked in
  // plans/GUI_INTERACTION_PLAN.md's #11 Completed note ("the xy family's
  // facet-export xKey/yKeys reset... ride #12's canonical-spec work").
  it("FIXED: facetByColumn preserves the live xKey/yKeys when the SAME dataset stays active, so a post-facet export reflects the pre-facet channel selection", async () => {
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
    expect(facetPanelsOf(useApp.getState().composition)?.length).toBe(2); // 2 finite grp levels

    // The panels captured the pre-facet selection AND the store's live
    // singleton fields now survive the trailing setActive call intact.
    expect(useApp.getState().xKey).toBe(1);
    expect(useApp.getState().yKeys).toEqual([0]);

    const body = await exportBody();
    expect(body.x_key).toBe(1); // the pre-facet x channel, not .time
    expect(body.y_keys).toEqual([0]); // the pre-facet y selection, not the dense fallback
  });

  it("a facetByColumn targeting a DIFFERENT (not-yet-active) dataset still resets to that dataset's defaults", async () => {
    const otherData: DataStruct = {
      time: [0, 1, 2, 3],
      values: [
        [5, 0],
        [6, 0],
        [7, 1],
        [8, 1],
      ],
      labels: ["C", "grp"],
      units: ["u", ""],
      metadata: {},
    };
    useApp.setState({
      datasets: [makeDataset(), { id: "d2", name: "other.dat", data: otherData }],
      activeId: "d1",
      xKey: null,
      yKeys: [0],
    });
    useApp.getState().facetByColumn("d2", 1); // d1 was active, not d2 — a genuine switch
    expect(useApp.getState().activeId).toBe("d2");
    // datasetViewDefaults still applies on a real switch: yKeys resets to
    // null (plot-all) since d1's [0] selection is meaningless for d2's columns.
    expect(useApp.getState().yKeys).toBeNull();
  });
});
