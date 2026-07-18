// GUI_INTERACTION #12 Slice 1 — the export-parity CONTRACT HARNESS.
//
// #12's design (plans/GUI_INTERACTION_PLAN.md) targets ONE canonical plot
// specification across Stage / Graph Builder / Figure Builder / export, but
// building the schema (Slice 2+) first needs an empirical definition of "one
// spec": a test suite that seeds the REAL `useApp` store the way a live
// session would, drives the actual `runExportFigureCommand`/
// `liveViewOverrides` request-assembly path, and asserts the captured
// request preserves what the screen shows. THIS file (+ its sibling
// `exportParity2.test.ts`) IS that empirical spec for today's adapter
// (Stage -> FigureSpec). Later slices upgrade these same assertions from
// "the adapter behaves this way" to "the canonical PlotSpec round-trips
// losslessly" — the matrix rows stay the checklist, only what backs them
// changes.
//
// Split from `exportFigureCommand.test.ts` (which already covers
// `liveViewOverrides` in isolation via a fake store getter, plus the #24
// x_fmt/y_fmt and #54-y2 request-builder wiring) — this suite instead seeds
// the SINGLETON store end-to-end, matching how a user's screen state would
// actually reach `runExportFigureCommand`. Overlap with that file is
// intentional where the fidelity differs (integration vs. unit); genuinely
// new coverage (permutation alignment, y2 display-order, the two documented
// gaps below) lives only here.
//
// This file: matrix rows 1-4 (axis limits, labels, scales/steps/formats,
// series display). `exportParity2.test.ts`: rows 5-8 (y2 split regression,
// annotations/shapes/legend/grid/ticks, error bars, fail-closed pins).
//
// Row 1 (below) and row 6 (sibling file) were ONCE real findings pinned with
// vitest's `it.fails`, per the task's instruction at the time to document
// rather than silently "fix" production code:
//   - Row 1 (FIXED, GUI_INTERACTION #12 slice 4a): `overrides.y2_lim` used
//     to be sent even when NO channel was tagged into `y2Keys` —
//     `liveViewOverrides` computes it unconditionally from `st.y2Lim`,
//     before `runExportFigureCommand` ever computes `y2Plotted`, so the
//     gate now lives at that call site instead
//     (`lib/figureOverrides.ts`'s `gateY2Overrides`, applied once
//     `y2Plotted` is known) — `liveViewOverrides` itself stays unchanged
//     and is still exercised directly (unaware of the plotted split) by
//     `exportFigureCommand.test.ts`.
//   - (row 6, in the sibling file) log minor ticks ignoring a log y2Scale —
//     also FIXED there, same slice.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { askParams } from "../components/overlays/ParamDialog";
import { exportFigure } from "./api";
import { runExportFigureCommand } from "./exportFigureCommand";
import { useApp } from "../store/useApp";
import type { DataStruct, Dataset } from "./types";

vi.mock("./api", () => ({
  exportFigure: vi.fn().mockResolvedValue(undefined),
}));

// vi.mock factories are hoisted above module-level consts, so the default
// params literal is inlined here; DEFAULT_PARAMS below (used by beforeEach
// and individual tests, which run AFTER hoisting) stays the single source
// for the rest of the file.
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

const DEFAULT_PARAMS = {
  fmt: "pdf",
  style: "default",
  dpi: 300,
  title: "",
  x_label: "",
  y_label: "",
};

// Four value channels (0..3 = A/B/C/D) over a shared x=time — enough columns
// to exercise reorder/hide/rename/style-alignment without the noise of a
// wider real-world file.
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

/** The full PlotView-relevant slice of default state, mirroring
 *  `store/useApp.ts`'s own initial-state block — reset in every `beforeEach`
 *  so tests in this file never depend on execution order or leak into
 *  siblings (`useApp` is one module-scoped singleton store across every
 *  `it` in a test file). */
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

// Grabs the MOST RECENT call, not calls[0] — several tests below call
// exportBody() twice in one `it` (seed A, assert, seed B, assert) to show a
// contrast, and mocks are only cleared in beforeEach, not between those two
// calls within a single test.
async function exportBody() {
  await runExportFigureCommand(useApp.getState);
  const calls = vi.mocked(exportFigure).mock.calls;
  return calls[calls.length - 1][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(exportFigure).mockResolvedValue(undefined);
  vi.mocked(askParams).mockResolvedValue({ ...DEFAULT_PARAMS });
  useApp.setState(baseline());
});

describe("1. Axis limits", () => {
  it("sends finite xLim/yLim as overrides.x_lim/y_lim", async () => {
    useApp.setState({ xLim: [1, 9], yLim: [0.1, 99] });
    const body = await exportBody();
    expect(body.overrides?.x_lim).toEqual([1, 9]);
    expect(body.overrides?.y_lim).toEqual([0.1, 99]);
  });

  it("omits x_lim/y_lim when the axis is autoscaled (null)", async () => {
    const body = await exportBody();
    expect(body.overrides).not.toHaveProperty("x_lim");
    expect(body.overrides).not.toHaveProperty("y_lim");
  });

  it("sends y2_lim when a y2 channel is actually plotted", async () => {
    useApp.setState({ y2Keys: [1], y2Lim: [-5, 5] });
    const body = await exportBody();
    expect(body.overrides?.y2_lim).toEqual([-5, 5]);
  });

  // FIXED (GUI_INTERACTION #12 slice 4a): figureOverrides.ts's own doc
  // comment says y2_lim is "only meaningful when the request also sets
  // y2_keys" — liveViewOverrides still reads st.y2Lim unconditionally (it
  // has no way to know the plotted/y2 split), but runExportFigureCommand
  // now gates the field itself (`gateY2Overrides`) once y2Plotted is known,
  // after `liveViewOverrides` has already run. A user who once used the
  // secondary axis, then untagged every y2 channel but never cleared the
  // stale range, no longer exports a y2_lim override the backend has no y2
  // axis to apply it to.
  it(
    "y2Lim does NOT reach overrides.y2_lim when no channel is tagged into y2Keys",
    async () => {
      useApp.setState({ y2Keys: null, y2Lim: [-5, 5] });
      const body = await exportBody();
      expect(body.overrides?.y2_lim).toBeUndefined();
    },
  );
});

describe("2. Labels", () => {
  it("sends a non-blank title/x_label/y_label verbatim, trimmed", async () => {
    vi.mocked(askParams).mockResolvedValue({
      ...DEFAULT_PARAMS,
      title: "  My Title  ",
      x_label: "  Q (1/nm)  ",
      y_label: "Reflectivity",
    });
    const body = await exportBody();
    expect(body.title).toBe("My Title");
    expect(body.x_label).toBe("Q (1/nm)");
    expect(body.y_label).toBe("Reflectivity");
  });

  // Documented asymmetry, not a bug: the backend's title has no "derive"
  // concept (calc/figure.py: `if title: ax.set_title(title)`), so a blank
  // title safely sends an explicit "". x_label/y_label DO have a "derive
  // from the plotted column" concept on the backend (`x_label: str | None =
  // None  # None = derive`), so a blank value must send undefined, not "" —
  // an empty string would suppress the derived label instead of restoring
  // it. Both encodings produce "no override effect" today; they are simply
  // different wire shapes for the same intent.
  it("a blank title sends an explicit empty string; blank x/y labels send undefined so the backend derives them", async () => {
    const body = await exportBody();
    expect(body.title).toBe("");
    expect(body.x_label).toBeUndefined();
    expect(body.y_label).toBeUndefined();
  });

  it("y2_label follows the same blank-omits/derive convention as x/y label", async () => {
    useApp.setState({ y2Keys: [1], y2AxisLabel: "   " });
    expect((await exportBody()).y2_label).toBeUndefined();
    useApp.setState({ y2AxisLabel: "Resistance (Ohm)" });
    expect((await exportBody()).y2_label).toBe("Resistance (Ohm)");
  });
});

describe("3. Scales + steps + tick formats", () => {
  it("x/y/y2 scale ride the request verbatim; a null y2Scale inherits the live yScale", async () => {
    useApp.setState({ xScale: "log", yScale: "reciprocal", y2Keys: [1], y2Scale: null });
    const inherited = await exportBody();
    expect(inherited.x_scale).toBe("log");
    expect(inherited.y_scale).toBe("reciprocal");
    expect(inherited.y2_scale).toBe("reciprocal"); // inherited, not "linear"

    useApp.setState({ y2Scale: "linear" }); // explicit y2Scale wins over inherit
    const explicit = await exportBody();
    expect(explicit.y2_scale).toBe("linear");
  });

  it("x/y major-tick step (Origin figure-apply parity) rides the request verbatim", async () => {
    useApp.setState({ xStep: 2000, yStep: 0.5 });
    const body = await exportBody();
    expect(body.x_step).toBe(2000);
    expect(body.y_step).toBe(0.5);
  });

  it("axisFmtParam: auto omits x_fmt/y_fmt; fixed/sci/eng send the live format verbatim", async () => {
    const auto = await exportBody();
    expect(auto.x_fmt).toBeUndefined();
    expect(auto.y_fmt).toBeUndefined();

    useApp.setState({
      xFmt: { mode: "fixed", digits: 3 },
      yFmt: { mode: "eng", digits: 0 },
    });
    const explicit = await exportBody();
    expect(explicit.x_fmt).toEqual({ mode: "fixed", digits: 3 });
    expect(explicit.y_fmt).toEqual({ mode: "eng", digits: 0 });
  });
});

describe("4. Series display: order, hidden, labels, style alignment", () => {
  it("seriesOrder reorders y_keys to the live display draw order", async () => {
    useApp.setState({ yKeys: [0, 1, 2, 3], seriesOrder: [3, 1, 0, 2] });
    const body = await exportBody();
    expect(body.y_keys).toEqual([3, 1, 0, 2]);
  });

  it("hiddenChannels are excluded from y_keys AFTER the seriesOrder reorder", async () => {
    useApp.setState({ yKeys: [0, 1, 2, 3], seriesOrder: [3, 1, 0, 2], hiddenChannels: [2] });
    const body = await exportBody();
    expect(body.y_keys).toEqual([3, 1, 0]);
  });

  it("seriesLabels rename the request-local dataset.labels without mutating the imported workbook", async () => {
    useApp.setState({ seriesLabels: { 0: "Measured signal" } });
    const body = await exportBody();
    expect(body.dataset.labels).toEqual(["Measured signal", "B", "C", "D"]);
    expect(useApp.getState().datasets[0].data.labels).toEqual(["A", "B", "C", "D"]);
  });

  // buildExportStyles indexes series_styles BY DISPLAY POSITION (i in the
  // plotted array), not by raw channel index — series_styles[i] must style
  // y_keys[i]. A permuted seriesOrder is the case that would silently break
  // if that alignment were ever done by channel index instead.
  it("series_styles[i] aligns to y_keys[i] (display position), not to the raw channel index, for a permuted order", async () => {
    useApp.setState({
      yKeys: [0, 1, 2],
      seriesOrder: [2, 0, 1],
      seriesStyles: {
        0: { color: "#111111" },
        1: { color: "#222222" },
        2: { color: "#333333" },
      },
    });
    const body = await exportBody();
    expect(body.y_keys).toEqual([2, 0, 1]);
    expect(body.series_styles?.[0]?.color).toBe("#333333"); // channel 2's color
    expect(body.series_styles?.[1]?.color).toBe("#111111"); // channel 0's color
    expect(body.series_styles?.[2]?.color).toBe("#222222"); // channel 1's color
  });
});
