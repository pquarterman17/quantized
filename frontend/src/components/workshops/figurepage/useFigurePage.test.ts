import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigurePage, renderFigurePageBlob } from "../../../lib/api";
import { clipboardImageSupported, copyImageAsync } from "../../../lib/clipboard";
import { createFigureDocument, type FigureDocument } from "../../../lib/figureDocument";
import type { FigureDoc } from "../../../lib/figuredoc";
import { createPageDocument } from "../../../lib/pageDocument";
import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useFigurePage } from "./useFigurePage";

vi.mock("../../../lib/api", () => ({
  exportFigurePage: vi.fn().mockResolvedValue(undefined),
  renderFigurePageBlob: vi
    .fn()
    .mockResolvedValue(new Blob(["png-bytes"], { type: "image/png" })),
  fetchBookData: vi.fn(),
}));

vi.mock("../../../lib/clipboard", () => ({
  clipboardImageSupported: vi.fn(() => true),
  copyImageAsync: vi.fn().mockResolvedValue(true),
}));

const askConfirm = vi.fn();
vi.mock("../../overlays/ConfirmDialog", () => ({
  askConfirm: (...args: unknown[]) => askConfirm(...args) as Promise<boolean>,
}));

const askParams = vi.fn();
vi.mock("../../overlays/ParamDialog", () => ({
  askParams: (...args: unknown[]) => askParams(...args) as Promise<Record<string, unknown> | null>,
}));

const DATA: DataStruct = {
  time: [0, 1, 2],
  values: [
    [1, 9],
    [2, 8],
    [3, 7],
  ],
  labels: ["A", "B"],
  units: ["u", "v"],
  metadata: {},
};

// F3.6: every REAL plot window carries a canonical FigureDocument since F1
// (createWindow always sets one; store/windowDocuments.ts keeps it in sync)
// — panelFigure/panelRenderInputs now render/invalidate from `.document`,
// not the ad-hoc `.view` fields, so a fixture that omitted `.document` would
// make its window silently unrenderable under the new path. Auto-derive one
// from whatever id/title/datasetId/view a call configures, unless the
// caller passes its own `document` explicitly (a few tests need a specific,
// known id to assert against).
function win(over: Partial<PlotWindow>): PlotWindow {
  const base: PlotWindow = {
    id: "w1",
    kind: "plot",
    title: "",
    datasetId: "d1",
    geometry: { x: 0, y: 0, w: 400, h: 300 },
    z: 0,
    winState: "normal",
    view: defaultPlotView(),
    bg: "theme",
    linkGroup: null,
    pinned: false,
    ...over,
  };
  if (base.kind === "plot" && over.document === undefined) {
    base.document = createFigureDocument({
      id: `figure-${base.id}`,
      name: base.title,
      datasetId: base.datasetId,
      view: base.view,
    });
  }
  return base;
}

const FROZEN_DOC: FigureDoc = {
  id: "f1",
  name: "MvsH figure",
  datasetId: null,
  live: false,
  dataSnapshot: DATA,
  config: {
    xKey: null,
    yKeys: [0],
    xScale: "linear",
    yScale: "log",
    title: "doc title",
    xLabel: "",
    yLabel: "",
    style: "aps",
    fmt: "pdf",
    dpi: 600,
    overrides: { grid: true, x_breaks: [[1, 2]], margins: { left: 0.2 } },
    seriesStyles: null,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "d1", name: "scan.dat", data: DATA }],
    activeId: "d1",
    focusedWindowId: null,
    plotWindows: [
      win({
        id: "w1",
        title: "Loop A",
        view: { ...defaultPlotView(), yKeys: [1], xScale: "log", plotTitle: "W title" },
      }),
      win({ id: "w2", title: "Unbound", datasetId: null }), // no dataset -> not a source
      win({ id: "w3", kind: "worksheet", title: "Sheet" }), // not a plot -> not a source
    ],
    figureDocs: [
      FROZEN_DOC,
      // Live doc whose dataset vanished: not renderable -> not a source.
      { ...FROZEN_DOC, id: "f2", name: "dead", live: true, datasetId: null, dataSnapshot: undefined },
    ],
    status: "",
  });
});

describe("useFigurePage", () => {
  it("enumerates live plot windows and renderable saved figures as sources", () => {
    const { result } = renderHook(() => useFigurePage());
    expect(result.current.windowSources).toEqual([
      { kind: "window", id: "w1", name: "Loop A" },
    ]);
    expect(result.current.docSources).toEqual([
      { kind: "figdoc", id: "f1", name: "MvsH figure" },
    ]);
  });

  it("assigns into slots and previews the auto label sequence", () => {
    const { result } = renderHook(() => useFigurePage());
    const [src] = result.current.windowSources;
    const [docSrc] = result.current.docSources;
    act(() => result.current.assign(3, src));
    act(() => result.current.assign(0, docSrc));
    // Row-major: slot 0 -> (a), slot 3 -> (b); empties stay blank.
    expect(result.current.labels).toEqual(["(a)", "", "", "(b)"]);
    // Re-assigning the window elsewhere moves it (appears once).
    act(() => result.current.assign(1, src));
    expect(result.current.slots[3].source).toBeNull();
    expect(result.current.slots[1].source?.id).toBe("w1");
  });

  // FIGURE_AUTHORING_WORKFLOW_PLAN F3.1: the hook maintains its grid geometry
  // and output settings as ONE PageDocument draft, and derives a full
  // persistable projection (`pageDocument`) — panels reference a canonical
  // FigureDocument id ONLY when the session source resolves to one that has
  // actually been saved into `editableFigures` (F3.2: reference, never flatten).
  describe("F3.1 pageDocument draft", () => {
    it("starts as an empty 2x2 document matching the default grid", () => {
      const { result } = renderHook(() => useFigurePage());
      expect(result.current.pageDocument).toMatchObject({
        schema: "quantized.page",
        version: 2, // F3.5 bumped the schema for the new `layout` field
        rows: 2,
        cols: 2,
      });
      expect(result.current.pageDocument.panels).toHaveLength(4);
      expect(result.current.pageDocument.panels.every((p) => p.figureId === null)).toBe(true);
    });

    it("tracks grid resize and output-setting writes", () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.setGrid(1, 3));
      act(() => {
        result.current.setFmt("svg");
        result.current.setLabelFormat("A)");
        result.current.setLabelPos("outside");
      });
      expect(result.current.pageDocument.rows).toBe(1);
      expect(result.current.pageDocument.cols).toBe(3);
      expect(result.current.pageDocument.panels).toHaveLength(3);
      expect(result.current.pageDocument.output).toMatchObject({
        format: "svg",
        labelFormat: "A)",
        labelPos: "outside",
      });
    });

    it("resolves a window source to its FigureDocument id once that document is saved", () => {
      const document = createFigureDocument({
        id: "figure-saved", name: "Loop A", datasetId: "d1", view: defaultPlotView(),
      });
      useApp.setState({
        plotWindows: [win({ id: "w1", title: "Loop A", document })],
        editableFigures: [document],
      });
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0]));
      expect(result.current.pageDocument.panels[0].figureId).toBe("figure-saved");
    });

    it("resolves an open-but-unsaved window (or a legacy figdoc) to null — never a lossy flattened copy", () => {
      const document = createFigureDocument({
        id: "figure-unsaved", name: "Loop A", datasetId: "d1", view: defaultPlotView(),
      });
      useApp.setState({
        plotWindows: [win({ id: "w1", title: "Loop A", document })],
        editableFigures: [], // never saved
      });
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0]));
      act(() => result.current.assign(1, result.current.docSources[0]));
      expect(result.current.pageDocument.panels[0].figureId).toBeNull();
      expect(result.current.pageDocument.panels[1].figureId).toBeNull();
    });
  });

  it("assignToNext fills the selected slot, else the first empty one", () => {
    const { result } = renderHook(() => useFigurePage());
    const [src] = result.current.windowSources;
    const [docSrc] = result.current.docSources;
    act(() => result.current.assignToNext(src)); // no selection -> slot 0
    expect(result.current.slots[0].source?.id).toBe("w1");
    act(() => result.current.setSelected(2));
    act(() => result.current.assignToNext(docSrc)); // selected -> slot 2
    expect(result.current.slots[2].source?.id).toBe("f1");
  });

  it("builds panel payloads from the window view / doc config", async () => {
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.windowSources[0]));
    act(() => result.current.assign(3, result.current.docSources[0]));
    const spec = await result.current.buildSpec();
    expect(spec).not.toBeNull();
    expect(spec!.rows).toBe(2);
    expect(spec!.cols).toBe(2);
    expect(spec!.panels).toHaveLength(2);

    const [p0, p1] = spec!.panels;
    // Window panel: grid cell (0,0), rendered from the window's own bound
    // FigureDocument (F3.6) — the canonical adapter emits x_scale (which the
    // backend prefers over the legacy x_log boolean; see api.ts's FigureSpec
    // doc), not x_log.
    expect([p0.row, p0.col]).toEqual([0, 0]);
    expect(p0.figure.dataset).toEqual(DATA);
    expect(p0.figure.y_keys).toEqual([1]);
    expect(p0.figure.x_scale).toBe("log");
    expect(p0.figure.title).toBe("W title");
    // Doc panel: grid cell (1,1), frozen snapshot + config; the page-
    // incompatible x_breaks/margins overrides are stripped, grid survives.
    expect([p1.row, p1.col]).toEqual([1, 1]);
    expect(p1.figure.dataset).toEqual(DATA);
    expect(p1.figure.y_log).toBe(true);
    expect(p1.figure.title).toBe("doc title");
    expect(p1.figure.overrides).toEqual({ grid: true });
    // MAIN #24: both sources default to auto (no saved fmt on a doc, no
    // configured fmt on the window's default view) -> x_fmt/y_fmt omitted.
    expect(p0.figure.x_fmt).toBeUndefined();
    expect(p0.figure.y_fmt).toBeUndefined();
    expect(p1.figure.x_fmt).toBeUndefined();
    expect(p1.figure.y_fmt).toBeUndefined();
  });

  it("threads a window panel's OWN non-auto x_fmt/y_fmt (MAIN #24 per-panel own view fmt)", async () => {
    useApp.setState({
      plotWindows: [
        win({
          id: "w1",
          title: "Loop A",
          view: {
            ...defaultPlotView(),
            xFmt: { mode: "fixed", digits: 3 },
            yFmt: { mode: "sci", digits: 1 },
            xStep: 2000,
            yStep: 0.5,
          },
        }),
      ],
    });
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.windowSources[0]));
    const spec = await result.current.buildSpec();
    expect(spec!.panels[0].figure.x_fmt).toEqual({ mode: "fixed", digits: 3 });
    expect(spec!.panels[0].figure.y_fmt).toEqual({ mode: "sci", digits: 1 });
    expect(spec!.panels[0].figure.x_step).toBe(2000);
    expect(spec!.panels[0].figure.y_step).toBe(0.5);
  });

  it("grid resize preserves assignments by position", () => {
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.windowSources[0]));
    act(() => result.current.assign(3, result.current.docSources[0]));
    act(() => result.current.setGrid(2, 3));
    // (0,0) stays at index 0; (1,1) moves to index 4 in the 2x3 grid.
    expect(result.current.slots).toHaveLength(6);
    expect(result.current.slots[0].source?.id).toBe("w1");
    expect(result.current.slots[4].source?.id).toBe("f1");
  });

  it("exports with page-level fmt/style/dpi and per-slot overrides", async () => {
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.windowSources[0]));
    act(() => {
      result.current.setFmt("svg");
      result.current.setStyle("aps"); // re-syncs dpi to the preset's 600
      result.current.setSlotLabel(0, "(ii)");
      result.current.setSlotTitle(0, "$\\mu_0 H$ loop");
    });
    await act(async () => {
      await result.current.exportNow();
    });
    const body = vi.mocked(exportFigurePage).mock.calls[0][0];
    expect(body.fmt).toBe("svg");
    expect(body.style).toBe("aps");
    expect(body.dpi).toBe(600);
    expect(body.label_format).toBe("(a)");
    expect(body.panels[0].label).toBe("(ii)");
    expect(body.panels[0].title).toBe("$\\mu_0 H$ loop");
  });

  it("moveSlot swaps two panels (source + label/title as one unit) and follows selection", () => {
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.windowSources[0]));
    act(() => result.current.setSlotLabel(0, "(iv)"));
    act(() => result.current.assign(3, result.current.docSources[0]));
    act(() => result.current.moveSlot(0, 3));
    expect(result.current.slots[3].source?.id).toBe("w1");
    expect(result.current.slots[3].label).toBe("(iv)"); // the caption travels WITH the panel
    expect(result.current.slots[0].source?.id).toBe("f1");
    expect(result.current.selected).toBe(3); // selection follows the moved panel
  });

  it("is inert when nothing is assigned", async () => {
    const { result } = renderHook(() => useFigurePage());
    await act(async () => {
      await result.current.exportNow();
    });
    expect(exportFigurePage).not.toHaveBeenCalled();
    expect(result.current.preview).toBeNull();
    expect(renderFigurePageBlob).not.toHaveBeenCalled();
  });

  it("renders a debounced low-DPI PNG preview through the page route", async () => {
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.windowSources[0]));
    await waitFor(() => expect(renderFigurePageBlob).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
    const body = vi.mocked(renderFigurePageBlob).mock.calls[0][0];
    expect(body.fmt).toBe("png");
    expect(body.dpi).toBe(90);
    await waitFor(() => expect(result.current.preview).toMatch(/^data:/));
  });

  // MAIN #8g: the preview is keyed on the store state the panels render from
  // (the same reads buildSpec's export-time guard makes) — a change UNDER an
  // assigned slot re-fetches it; unrelated store churn does not.
  describe("preview invalidation (#8g)", () => {
    it("re-renders when the assigned dataset's data changes underneath the slot", async () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0]));
      await waitFor(() => expect(renderFigurePageBlob).toHaveBeenCalledTimes(1), {
        timeout: 2000,
      });
      // The dataset is corrected/recomputed: its data object is REPLACED.
      const corrected: DataStruct = {
        ...DATA,
        values: DATA.values.map((row) => row.map((v) => v * 2)),
      };
      act(() => {
        useApp.setState({ datasets: [{ id: "d1", name: "scan.dat", data: corrected }] });
      });
      await waitFor(() => expect(renderFigurePageBlob).toHaveBeenCalledTimes(2), {
        timeout: 2000,
      });
      const body = vi.mocked(renderFigurePageBlob).mock.calls[1][0];
      expect(body.panels[0].figure.dataset).toEqual(corrected);
    });

    it("re-renders on the assigned window's view change but NOT on unrelated churn", async () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0]));
      await waitFor(() => expect(renderFigurePageBlob).toHaveBeenCalledTimes(1), {
        timeout: 2000,
      });
      // Unrelated churn: status message + ANOTHER window moving -> no fetch.
      act(() => {
        useApp.setState((s) => ({
          status: "poke",
          plotWindows: s.plotWindows.map((w) =>
            w.id === "w2" ? { ...w, geometry: { ...w.geometry, x: 50 } } : w,
          ),
        }));
      });
      await new Promise((r) => setTimeout(r, 600)); // past the 400 ms debounce
      expect(renderFigurePageBlob).toHaveBeenCalledTimes(1);
      // The ASSIGNED window's view changes (title edited) -> re-render. F3.6:
      // the panel now renders from the window's bound `.document`, not
      // `.view` — a real edit keeps both in sync (syncPlotWindow), so the
      // fixture updates both here too, exactly like a real title edit would.
      act(() => {
        useApp.setState((s) => ({
          plotWindows: s.plotWindows.map((w) =>
            w.id === "w1" && w.document
              ? {
                  ...w,
                  view: { ...w.view, plotTitle: "renamed" },
                  document: {
                    ...w.document,
                    plot: { ...w.document.plot, view: { ...w.document.plot.view, plotTitle: "renamed" } },
                  },
                }
              : w,
          ),
        }));
      });
      await waitFor(() => expect(renderFigurePageBlob).toHaveBeenCalledTimes(2), {
        timeout: 2000,
      });
      expect(vi.mocked(renderFigurePageBlob).mock.calls[1][0].panels[0].figure.title).toBe(
        "renamed",
      );
    });

    it("re-renders when an assigned saved figure (doc) is edited", async () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.docSources[0]));
      await waitFor(() => expect(renderFigurePageBlob).toHaveBeenCalledTimes(1), {
        timeout: 2000,
      });
      act(() => {
        useApp.setState((s) => ({
          figureDocs: s.figureDocs.map((d) =>
            d.id === "f1" ? { ...d, config: { ...d.config, title: "edited title" } } : d,
          ),
        }));
      });
      await waitFor(() => expect(renderFigurePageBlob).toHaveBeenCalledTimes(2), {
        timeout: 2000,
      });
      expect(vi.mocked(renderFigurePageBlob).mock.calls[1][0].panels[0].figure.title).toBe(
        "edited title",
      );
    });
  });

  // FIGURE_AUTHORING_WORKFLOW_PLAN F3.5: gap/link/align/resize-mode controls.
  describe("F3.5 layout controls", () => {
    it("starts with DEFAULT_LAYOUT and buildSpec sends it as today's exact defaults", async () => {
      const { result } = renderHook(() => useFigurePage());
      expect(result.current.layout).toEqual({
        rowGap: null,
        colGap: null,
        linkX: false,
        linkY: false,
        alignLabels: false,
        resizeMode: "constrained",
      });
      act(() => result.current.assign(0, result.current.windowSources[0]));
      const spec = await result.current.buildSpec();
      expect(spec).toMatchObject({
        row_gap: null,
        col_gap: null,
        link_x: false,
        link_y: false,
        align_labels: false,
        resize_mode: "constrained",
      });
    });

    it("setLayout patches only the given fields, preserving the rest", () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.setLayout({ linkX: true, rowGap: 0.3 }));
      expect(result.current.layout).toMatchObject({ linkX: true, rowGap: 0.3, linkY: false });
      act(() => result.current.setLayout({ resizeMode: "tight" }));
      expect(result.current.layout).toMatchObject({ linkX: true, rowGap: 0.3, resizeMode: "tight" });
    });

    it("buildSpec threads a customized layout through to the request", async () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0]));
      act(() =>
        result.current.setLayout({
          rowGap: 0.1,
          colGap: 0.2,
          linkX: true,
          linkY: true,
          alignLabels: true,
          resizeMode: "none",
        }),
      );
      const spec = await result.current.buildSpec();
      expect(spec).toMatchObject({
        row_gap: 0.1,
        col_gap: 0.2,
        link_x: true,
        link_y: true,
        align_labels: true,
        resize_mode: "none",
      });
    });

    it("a layout change re-renders the debounced preview, like a style/label change does", async () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0]));
      await waitFor(() => expect(renderFigurePageBlob).toHaveBeenCalledTimes(1), { timeout: 2000 });
      act(() => result.current.setLayout({ linkX: true }));
      await waitFor(() => expect(renderFigurePageBlob).toHaveBeenCalledTimes(2), { timeout: 2000 });
      expect(vi.mocked(renderFigurePageBlob).mock.calls[1][0].link_x).toBe(true);
    });
  });

  // FIGURE_AUTHORING_WORKFLOW_PLAN F3.2: missing-source behavior, surfaced.
  describe("F3.2 missing-source semantics", () => {
    it("exposes per-slot live status: empty/ok-live/ok-frozen alongside the slots", () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0])); // live window
      act(() => result.current.assign(1, result.current.docSources[0])); // frozen figdoc (FROZEN_DOC)
      expect(result.current.sourceStatuses[0]).toEqual({ status: "ok", lifecycle: "live" });
      expect(result.current.sourceStatuses[1]).toEqual({ status: "ok", lifecycle: "frozen" });
      expect(result.current.sourceStatuses[2]).toEqual({ status: "empty" });
    });

    it("reports missing once an assigned window's source disappears (closed) — status flips live", () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0]));
      expect(result.current.sourceStatuses[0]).toEqual({ status: "ok", lifecycle: "live" });
      act(() => {
        useApp.setState((s) => ({ plotWindows: s.plotWindows.filter((w) => w.id !== "w1") }));
      });
      expect(result.current.sourceStatuses[0]).toEqual({ status: "missing" });
    });

    it("reports missing once an assigned figdoc is deleted from the library", () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.docSources[0]));
      expect(result.current.sourceStatuses[0]).toEqual({ status: "ok", lifecycle: "frozen" });
      act(() => {
        useApp.setState((s) => ({ figureDocs: s.figureDocs.filter((d) => d.id !== "f1") }));
      });
      expect(result.current.sourceStatuses[0]).toEqual({ status: "missing" });
    });

    // Fail-before/pass-after: the preview effect used to unconditionally
    // setError(null) right after buildSpec() had ALREADY set the specific
    // "slot N: ... no longer exists" message for a dead source, so the
    // preview panel silently reverted to the plain empty-state text with no
    // explanation at all — a "hole without explanation", exactly what F3.2
    // rules out. Reverting the fix (re-adding that setError(null) call) makes
    // this test fail: `error` would settle to null instead of the message.
    it("keeps the specific missing-source message on screen instead of clobbering it back to null", async () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0]));
      await waitFor(() => expect(renderFigurePageBlob).toHaveBeenCalledTimes(1), { timeout: 2000 });
      act(() => {
        useApp.setState((s) => ({ plotWindows: s.plotWindows.filter((w) => w.id !== "w1") }));
      });
      await waitFor(
        () => expect(result.current.error).toMatch(/slot 1: source "Loop A" no longer exists/),
        { timeout: 2000 },
      );
      expect(result.current.preview).toBeNull();
      // No SECOND preview fetch was attempted for the dead source.
      expect(renderFigurePageBlob).toHaveBeenCalledTimes(1);
    });

    it("gives a specific export status for a missing source, not the generic 'assign a panel' message", async () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0]));
      act(() => {
        useApp.setState((s) => ({ plotWindows: s.plotWindows.filter((w) => w.id !== "w1") }));
      });
      await act(async () => {
        await result.current.exportNow();
      });
      expect(exportFigurePage).not.toHaveBeenCalled();
      const status = useApp.getState().status;
      expect(status).toMatch(/panel's source is missing/);
      expect(status).not.toBe("assign at least one panel to export a figure page");
    });

    it("still gives the plain 'assign a panel' message when truly nothing is assigned", async () => {
      const { result } = renderHook(() => useFigurePage());
      await act(async () => {
        await result.current.exportNow();
      });
      expect(useApp.getState().status).toBe("assign at least one panel to export a figure page");
    });
  });
});

// FIGURE_AUTHORING_WORKFLOW_PLAN F3.3: Save/Save As/dirty state/reopen.
describe("useFigurePage F3.3 save/reopen/dirty", () => {
  const FIGURE: FigureDocument = createFigureDocument({
    id: "figure-1",
    name: "Saved loop",
    datasetId: "d1",
    view: { ...defaultPlotView(), yKeys: [1], plotTitle: "Saved loop title" },
  });

  beforeEach(() => {
    askConfirm.mockReset();
    askParams.mockReset();
    useApp.setState({ editableFigures: [], pages: [], pageDocSeed: null, figurePageOpen: false });
  });

  it("figureSources enumerates renderable saved (editable) figures", () => {
    useApp.setState({ editableFigures: [FIGURE] });
    const { result } = renderHook(() => useFigurePage());
    expect(result.current.figureSources).toEqual([
      { kind: "figure", id: "figure-1", name: "Saved loop" },
    ]);
  });

  it("refuses to save an open-but-unsaved window panel, naming the slot and the fix", () => {
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.windowSources[0]));
    act(() => result.current.save());
    expect(useApp.getState().pages).toEqual([]);
    expect(useApp.getState().status).toMatch(/cannot save page/);
    expect(useApp.getState().status).toMatch(/"Loop A" is an open plot window not yet saved/);
  });

  it("refuses to save a legacy Publication figure panel, pointing at the Editable conversion", () => {
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.docSources[0]));
    act(() => result.current.save());
    expect(useApp.getState().pages).toEqual([]);
    expect(useApp.getState().status).toMatch(/is a Publication figure/);
    expect(useApp.getState().status).toMatch(/create an editable copy/);
  });

  it("saves a page whose panels are all resolved (figure-kind sources), and clears dirty", () => {
    useApp.setState({ editableFigures: [FIGURE] });
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.figureSources[0]));
    expect(result.current.dirty).toBe(true);

    act(() => result.current.save());
    expect(useApp.getState().pages).toHaveLength(1);
    expect(useApp.getState().pages[0].panels[0].figureId).toBe("figure-1");
    expect(result.current.dirty).toBe(false);
    expect(result.current.everSaved).toBe(true);
  });

  it("becomes dirty again after a saved page is edited further", () => {
    useApp.setState({ editableFigures: [FIGURE] });
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.figureSources[0]));
    act(() => result.current.save());
    expect(result.current.dirty).toBe(false);

    act(() => result.current.setName("Renamed"));
    expect(result.current.dirty).toBe(true);
  });

  it("Save As creates a new named entry and rebinds the session to it", async () => {
    useApp.setState({ editableFigures: [FIGURE] });
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.figureSources[0]));
    askParams.mockResolvedValueOnce({ name: "Copy of page" });

    await act(async () => {
      await result.current.saveAs();
    });

    expect(useApp.getState().pages).toHaveLength(1);
    expect(useApp.getState().pages[0].name).toBe("Copy of page");
    expect(result.current.dirty).toBe(false);

    // A later plain Save updates the SAME (new) entry, not a second one.
    act(() => result.current.setName("Copy of page")); // no-op edit, still clean-equivalent
    act(() => result.current.save());
    expect(useApp.getState().pages).toHaveLength(1);
  });

  it("Save As refuses the same unresolved-panel check as Save", async () => {
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.docSources[0]));
    await act(async () => {
      await result.current.saveAs();
    });
    expect(askParams).not.toHaveBeenCalled();
    expect(useApp.getState().pages).toEqual([]);
  });

  it("reopens a saved page: grid, output, and panel references are restored", () => {
    const saved = createPageDocument({
      id: "page-1",
      name: "Reopened page",
      rows: 1,
      cols: 2,
      panels: [
        { figureId: "figure-1", label: "(x)", title: "custom" },
        { figureId: null, label: null, title: null },
      ],
      output: { format: "svg", stylePreset: "aps", dpi: 600, labelFormat: "A)", labelPos: "outside" },
    });
    useApp.setState({ editableFigures: [FIGURE], pages: [saved] });
    useApp.getState().openPageDocument("page-1");

    const { result } = renderHook(() => useFigurePage());
    expect(result.current.name).toBe("Reopened page");
    expect(result.current.rows).toBe(1);
    expect(result.current.cols).toBe(2);
    expect(result.current.fmt).toBe("svg");
    expect(result.current.style).toBe("aps");
    expect(result.current.slots[0].source).toEqual({
      kind: "figure",
      id: "figure-1",
      name: "Saved loop",
    });
    expect(result.current.slots[0].label).toBe("(x)");
    expect(result.current.slots[0].title).toBe("custom");
    expect(result.current.slots[1].source).toBeNull();
    // Reopening an unmodified page is clean, not dirty.
    expect(result.current.dirty).toBe(false);
    expect(useApp.getState().pageDocSeed).toBeNull(); // one-shot seed consumed
  });

  it("reopening a page whose figure was since deleted surfaces it as missing, not dropped", () => {
    const saved = createPageDocument({
      id: "page-1",
      name: "Stale page",
      panels: [{ figureId: "figure-gone", label: null, title: null }],
    });
    useApp.setState({ editableFigures: [], pages: [saved] }); // the figure never existed here
    useApp.getState().openPageDocument("page-1");

    const { result } = renderHook(() => useFigurePage());
    expect(result.current.slots[0].source).toMatchObject({ kind: "figure", id: "figure-gone" });
    expect(result.current.sourceStatuses[0]).toEqual({ status: "missing" });
    // The dangling reference survives a re-save rather than being silently dropped.
    act(() => result.current.save());
    expect(useApp.getState().pages[0].panels[0].figureId).toBe("figure-gone");
  });

  describe("requestClose", () => {
    it("closes a fresh, never-saved page without any confirm", async () => {
      const { result } = renderHook(() => useFigurePage());
      const ok = await result.current.requestClose();
      expect(ok).toBe(true);
      expect(askConfirm).not.toHaveBeenCalled();
    });

    it("gates a SAVED page that has since drifted, and cancel keeps it open", async () => {
      useApp.setState({ editableFigures: [FIGURE] });
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.figureSources[0]));
      act(() => result.current.save());
      act(() => result.current.setName("Drifted"));

      askConfirm.mockResolvedValueOnce(false);
      expect(await result.current.requestClose()).toBe(false);
      expect(askConfirm).toHaveBeenCalledOnce();

      askConfirm.mockResolvedValueOnce(true);
      expect(await result.current.requestClose()).toBe(true);
    });

    it("closes an unmodified reopened (saved) page without a confirm", async () => {
      const saved = createPageDocument({ id: "page-1", name: "Clean page" });
      useApp.setState({ pages: [saved] });
      useApp.getState().openPageDocument("page-1");
      const { result } = renderHook(() => useFigurePage());
      expect(await result.current.requestClose()).toBe(true);
      expect(askConfirm).not.toHaveBeenCalled();
    });
  });

  // FIGURE_AUTHORING_WORKFLOW_PLAN F3.4: "unify panel editing" — double-
  // click/context-menu actions dispatch through these hook functions;
  // SlotGrid.test.tsx covers the UI wiring, this covers the store effects.
  describe("F3.4 panel editing", () => {
    it("editSlot opens/focuses a window bound to a figure-kind panel's document", () => {
      useApp.setState({ editableFigures: [FIGURE] });
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.figureSources[0]));
      const before = useApp.getState().plotWindows.length;
      act(() => result.current.editSlot(0));
      const after = useApp.getState();
      expect(after.plotWindows.length).toBe(before + 1);
      const opened = after.plotWindows.find((w) => w.kind === "plot" && w.document?.id === "figure-1");
      expect(opened).toBeDefined();
      expect(after.focusedWindowId).toBe(opened!.id);
    });

    it("editSlot focuses a window-kind panel's already-open window", () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0]));
      expect(useApp.getState().focusedWindowId).not.toBe("w1");
      act(() => result.current.editSlot(0));
      expect(useApp.getState().focusedWindowId).toBe("w1");
    });

    it("editSlot restores a minimized window-kind panel's window instead of merely focusing it", () => {
      useApp.setState((s) => ({
        plotWindows: s.plotWindows.map((w) => (w.id === "w1" ? { ...w, winState: "minimized" } : w)),
      }));
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0]));
      act(() => result.current.editSlot(0));
      const w1 = useApp.getState().plotWindows.find((w) => w.id === "w1");
      expect(w1?.winState).toBe("normal");
      expect(useApp.getState().focusedWindowId).toBe("w1");
    });

    it("promoteSlot converts a figdoc-kind panel to an editable copy and repoints the slot at it", () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.docSources[0])); // FROZEN_DOC ("f1")
      expect(useApp.getState().editableFigures).toHaveLength(0);

      act(() => result.current.promoteSlot(0));

      const figures = useApp.getState().editableFigures;
      expect(figures).toHaveLength(1);
      expect(result.current.slots[0].source).toMatchObject({ kind: "figure", id: figures[0].id });
      // The panel now resolves — this is exactly what F3.3's unresolved-slot
      // Save block was pointing the user to do manually.
      expect(result.current.pageDocument.panels[0].figureId).toBe(figures[0].id);
    });

    // F0.3's third compat surface: promoteSlot now gates through the same
    // figureDocPublicationCompatibility report the Library "Editable" button
    // uses. A context menu / double-click gesture has no button to disable,
    // so a blocked source refuses via a status message instead.
    it("promoteSlot refuses with a status message (no confirm, no copy) when the source has since become blocked", () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.docSources[0])); // FROZEN_DOC ("f1")

      // Simulate F3.2's "died while assigned" case: the frozen doc loses its
      // snapshot after the slot already points at it.
      act(() => {
        useApp.setState((s) => ({
          figureDocs: s.figureDocs.map((d) => (d.id === "f1" ? { ...d, dataSnapshot: undefined } : d)),
        }));
      });

      act(() => result.current.promoteSlot(0));

      expect(useApp.getState().editableFigures).toHaveLength(0);
      expect(askConfirm).not.toHaveBeenCalled();
      expect(useApp.getState().status).toContain('cannot create an editable copy of "MvsH figure"');
      expect(useApp.getState().status).toContain("frozen data snapshot is unavailable");
    });

    it("promoteSlot confirms before creating a lossy editable copy, and only promotes when confirmed", async () => {
      // FROZEN_DOC's overrides carry no shapes/ref_lines; add one so the
      // promotion is genuinely lossy (figureDocumentFromLegacyFigureDoc
      // carries shapes/ref_lines raw into publication.overrides without
      // ever populating plot.view.shapes/refLines — see
      // figureCompatibility.ts's figureDocPublicationCompatibility).
      const lossy: FigureDoc = {
        ...FROZEN_DOC,
        id: "f3",
        name: "Lossy figure",
        config: {
          ...FROZEN_DOC.config,
          overrides: { ...FROZEN_DOC.config.overrides, shapes: [{ kind: "line", x1: 0, y1: 0, x2: 1, y2: 1 }] },
        },
      };
      useApp.setState((s) => ({ figureDocs: [...s.figureDocs, lossy] }));
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, { kind: "figdoc", id: "f3", name: "Lossy figure" }));

      askConfirm.mockResolvedValueOnce(false);
      await act(() => result.current.promoteSlot(0));
      expect(useApp.getState().editableFigures).toHaveLength(0);
      expect(askConfirm).toHaveBeenCalledOnce();

      askConfirm.mockResolvedValueOnce(true);
      await act(() => result.current.promoteSlot(0));
      const figures = useApp.getState().editableFigures;
      expect(figures).toHaveLength(1);
      expect(result.current.slots[0].source).toMatchObject({ kind: "figure", id: figures[0].id });
    });

    it("duplicateForPage duplicates a figure-kind panel's document and repoints THIS slot, leaving the original untouched", () => {
      useApp.setState({ editableFigures: [FIGURE] });
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.figureSources[0]));

      act(() => result.current.duplicateForPage(0));

      const figures = useApp.getState().editableFigures;
      expect(figures).toHaveLength(2);
      expect(figures.find((f) => f.id === "figure-1")).toBeDefined(); // original unchanged
      const slot0 = result.current.slots[0].source;
      expect(slot0?.kind).toBe("figure");
      expect(slot0?.id).not.toBe("figure-1"); // repointed at the copy, not the original
      expect(useApp.getState().status).toMatch(/duplicated .* for this page/);
    });

    it("duplicateForPage is a no-op for a window- or figdoc-kind panel", () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0]));
      act(() => result.current.assign(1, result.current.docSources[0]));
      act(() => {
        result.current.duplicateForPage(0);
        result.current.duplicateForPage(1);
      });
      expect(useApp.getState().editableFigures).toHaveLength(0);
      expect(result.current.slots[0].source?.id).toBe("w1");
      expect(result.current.slots[1].source?.id).toBe("f1");
    });

    it("saveSlotAsFigure saves a window-kind panel's document, and the slot auto-resolves next read", () => {
      // saveFigure (the store action this delegates to) reads the window's
      // OWN bound document (`win()` auto-derives one, but with a
      // fixture-generated id) — give w1 a SPECIFIC known id here so the
      // assertions below can name it, matching the F3.1 "resolves a window
      // source..." test's own setup a few describes up.
      const document = createFigureDocument({
        id: "figure-w1", name: "Loop A", datasetId: "d1", view: defaultPlotView(),
      });
      useApp.setState({ plotWindows: [win({ id: "w1", title: "Loop A", document })] });
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0]));
      expect(result.current.pageDocument.panels[0].figureId).toBeNull(); // not yet resolvable

      act(() => result.current.saveSlotAsFigure(0));

      const figures = useApp.getState().editableFigures;
      expect(figures).toHaveLength(1);
      expect(figures[0].id).toBe("figure-w1");
      // "window" kind is unchanged — no reassignment needed, unlike promote/duplicate.
      expect(result.current.slots[0].source).toMatchObject({ kind: "window", id: "w1" });
      expect(result.current.pageDocument.panels[0].figureId).toBe("figure-w1");
    });

    it("saveSlotAsFigure is a no-op for a figure- or figdoc-kind panel", () => {
      useApp.setState({ editableFigures: [FIGURE] });
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.figureSources[0]));
      act(() => result.current.assign(1, result.current.docSources[0]));
      act(() => {
        result.current.saveSlotAsFigure(0);
        result.current.saveSlotAsFigure(1);
      });
      expect(useApp.getState().editableFigures).toHaveLength(1); // unchanged: still just FIGURE
    });

    // F3.4 item 3: the preview must pick up an edit to a REFERENCED canonical
    // figure. The existing #8g coverage (top describe block) only exercised
    // the "figdoc" branch of panelRenderInputs — this closes the gap for the
    // newer "figure" (F3.3) branch, which tracks the document object itself.
    it("re-renders the preview when an assigned canonical figure (figure kind) is edited", async () => {
      useApp.setState({ editableFigures: [FIGURE] });
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.figureSources[0]));
      await waitFor(() => expect(renderFigurePageBlob).toHaveBeenCalledTimes(1), { timeout: 2000 });

      act(() => {
        useApp.setState((s) => ({
          editableFigures: s.editableFigures.map((d) =>
            d.id === "figure-1"
              ? { ...d, plot: { ...d.plot, view: { ...d.plot.view, plotTitle: "edited canonical title" } } }
              : d,
          ),
        }));
      });

      await waitFor(() => expect(renderFigurePageBlob).toHaveBeenCalledTimes(2), { timeout: 2000 });
      expect(vi.mocked(renderFigurePageBlob).mock.calls[1][0].panels[0].figure.title).toBe(
        "edited canonical title",
      );
    });
  });
});

// FIGURE_AUTHORING_WORKFLOW_PLAN F3.6: one spec-derivation path (buildSpec)
// for preview/export/copy, the window-panel fidelity fix, and the F3 exit
// criterion's round-trip proof (save -> reopen -> export retains every
// panel, relationship, and visual setting).
describe("useFigurePage F3.6 unified export from PageDocument", () => {
  beforeEach(() => {
    askConfirm.mockReset();
    vi.mocked(clipboardImageSupported).mockReturnValue(true);
    vi.mocked(copyImageAsync).mockResolvedValue(true);
    useApp.setState({ editableFigures: [], pages: [], pageDocSeed: null, figurePageOpen: false });
  });

  // The gap this closes (see panelResolve.ts's module header): the old
  // ad-hoc window branch never threaded error bindings through at all, so a
  // window's error bars silently vanished from its page panel. Fail-before/
  // pass-after: reverting panelFigure's window branch to the pre-F3.6
  // hand-assembled spec makes this fail (error_spans absent).
  it("renders a window panel's error bars, not just its ad-hoc PlotView fields", async () => {
    useApp.setState({
      plotWindows: [
        win({
          id: "w1",
          title: "Loop A",
          view: { ...defaultPlotView(), yKeys: [1], errKeys: { 1: 0 } },
        }),
      ],
    });
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assign(0, result.current.windowSources[0]));
    const spec = await result.current.buildSpec();
    expect(spec!.panels[0].figure.error_spans).toBeDefined();
    expect(spec!.panels[0].figure.error_spans![0]).not.toBeNull();
  });

  // The F3 exit criterion, proven directly: a window-sourced panel's spec
  // BEFORE save must equal the SAME panel's spec after save -> (simulated)
  // close -> reopen, once the window's document is already durable
  // (Save requires that anyway — F3.3's unresolved-slot gate). Round-tripping
  // through the persisted PageDocument must not change a single byte of what
  // gets rendered.
  it("round-trips: a saved page's reopened spec equals its pre-save spec byte-for-byte", async () => {
    const seeded = win({
      id: "w1",
      title: "Loop A",
      view: { ...defaultPlotView(), yKeys: [1], plotTitle: "Loop A plot", errKeys: { 1: 0 } },
    });
    useApp.setState({
      plotWindows: [seeded],
      editableFigures: [seeded.document!], // already saved, matching F3.3's Save precondition
    });

    const before = renderHook(() => useFigurePage());
    act(() => before.result.current.assign(0, before.result.current.windowSources[0]));
    act(() => before.result.current.setSlotLabel(0, "(zz)"));
    act(() => before.result.current.setSlotTitle(0, "custom panel title"));
    const specBeforeSave = await before.result.current.buildSpec();
    expect(specBeforeSave).not.toBeNull();

    act(() => before.result.current.save());
    const savedId = useApp.getState().pages[0].id;
    expect(useApp.getState().pages[0].panels[0].figureId).toBe(seeded.document!.id);
    before.unmount();

    // Simulated close -> reopen: a fresh session seeded from the saved
    // PageDocument (mirrors PagesSection's "open" action + the workshop
    // remounting), not the same hook instance continuing.
    useApp.getState().openPageDocument(savedId);
    const after = renderHook(() => useFigurePage());
    expect(after.result.current.slots[0].source).toMatchObject({ kind: "figure", id: seeded.document!.id });
    const specAfterReopen = await after.result.current.buildSpec();

    expect(specAfterReopen).toEqual(specBeforeSave);
  });

  describe("copyNow (300-DPI clipboard copy, A7)", () => {
    it("copies through the SAME buildSpec preview/export share", async () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0]));
      await act(async () => {
        await result.current.copyNow();
      });
      expect(copyImageAsync).toHaveBeenCalledTimes(1);
      // copyImageAsync receives the PENDING render promise (not yet awaited)
      // so the clipboard write stays inside the user gesture — resolve it to
      // inspect what was actually rendered.
      const pending = vi.mocked(copyImageAsync).mock.calls[0][0];
      await expect(pending).resolves.toBeInstanceOf(Blob);
      const body = vi.mocked(renderFigurePageBlob).mock.calls.at(-1)![0];
      expect(body.fmt).toBe("png");
      expect(body.dpi).toBe(300);
      expect(useApp.getState().status).toBe("figure page copied to clipboard");
    });

    it("checks clipboard capability BEFORE doing any render work", async () => {
      vi.mocked(clipboardImageSupported).mockReturnValue(false);
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0]));
      vi.mocked(renderFigurePageBlob).mockClear();
      await act(async () => {
        await result.current.copyNow();
      });
      expect(copyImageAsync).not.toHaveBeenCalled();
      expect(renderFigurePageBlob).not.toHaveBeenCalled();
      expect(useApp.getState().status).toMatch(/clipboard image unavailable/);
    });

    it("gives the same specific missing-source message export uses, not a generic failure", async () => {
      const { result } = renderHook(() => useFigurePage());
      act(() => result.current.assign(0, result.current.windowSources[0]));
      act(() => {
        useApp.setState((s) => ({ plotWindows: s.plotWindows.filter((w) => w.id !== "w1") }));
      });
      await act(async () => {
        await result.current.copyNow();
      });
      expect(copyImageAsync).not.toHaveBeenCalled();
      expect(useApp.getState().status).toMatch(/panel's source is missing/);
    });

    it("gives the plain 'assign a panel' message when nothing is assigned", async () => {
      const { result } = renderHook(() => useFigurePage());
      await act(async () => {
        await result.current.copyNow();
      });
      expect(copyImageAsync).not.toHaveBeenCalled();
      expect(useApp.getState().status).toBe("assign at least one panel to copy a figure page");
    });
  });
});
