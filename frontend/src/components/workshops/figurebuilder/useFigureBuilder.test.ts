import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigure, fetchBookData, renderFigureHitmap } from "../../../lib/api";
import { createFigureDocument } from "../../../lib/figureDocument";
import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import { pxToData } from "../../../lib/previewmap";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { FIGURE_STYLE_DPI, useFigureBuilder } from "./useFigureBuilder";

vi.mock("../../../lib/api", () => ({
  exportFigure: vi.fn().mockResolvedValue(undefined),
  // the preview now renders through the #13 hit-map endpoint
  renderFigureHitmap: vi.fn().mockResolvedValue({
    image: "cGln",
    width: 600,
    height: 400,
    elements: [{ id: "title", x0: 1, y0: 1, x1: 2, y1: 2 }],
    axes: { x0: 0, y0: 0, x1: 600, y1: 400, xlim: [0, 1], ylim: [0, 1], xlog: false, ylog: false },
  }),
  fetchBookData: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "d1", name: "scan.dat", data: DATA }],
    activeId: "d1",
    yKeys: null,
    xScale: "linear",
    yScale: "linear",
    xFmt: { mode: "auto", digits: 2 },
    yFmt: { mode: "auto", digits: 2 },
    seriesStyles: {},
    figureDocSeed: null,
    figurePublicationSession: null,
    figureBuilderOpen: false,
    status: "",
  });
});

describe("useFigureBuilder", () => {
  it("renders a debounced preview + hit-map from the active dataset", async () => {
    const { result } = renderHook(() => useFigureBuilder());
    await waitFor(() => expect(renderFigureHitmap).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(result.current.preview).toBe("data:image/png;base64,cGln"),
    );
    expect(result.current.hitmap?.elements[0].id).toBe("title");
  });

  it("exports at the chosen format/DPI with the dataset stem as filename", async () => {
    const { result } = renderHook(() => useFigureBuilder());
    act(() => {
      result.current.setFmt("svg");
      result.current.setTitle("My Figure");
    });
    await act(async () => {
      await result.current.exportNow();
    });
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.fmt).toBe("svg");
    expect(body.title).toBe("My Figure");
    expect(body.filename).toBe("scan"); // extension stripped
  });

  it("is inert with no active dataset", async () => {
    useApp.setState({ datasets: [], activeId: null });
    const { result } = renderHook(() => useFigureBuilder());
    await act(async () => {
      await result.current.exportNow();
    });
    expect(exportFigure).not.toHaveBeenCalled();
    expect(result.current.preview).toBeNull();
  });

  it("resolves a still-pending active dataset before exporting (#38)", async () => {
    const full: DataStruct = {
      time: [0, 1, 2, 3],
      values: [
        [1, 9],
        [2, 8],
        [3, 7],
        [4, 6],
      ],
      labels: ["A", "B"],
      units: ["u", "v"],
      metadata: {},
    };
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "book.opj",
          data: { time: [0], values: [[1, 9]], labels: ["A", "B"], units: ["u", "v"], metadata: {} },
          pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 4, cols: 2 },
        },
      ],
      activeId: "d1",
    });
    vi.mocked(fetchBookData).mockResolvedValue(full);
    const { result } = renderHook(() => useFigureBuilder());

    await act(async () => {
      await result.current.exportNow();
    });

    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.dataset).toEqual(full);
    expect(useApp.getState().datasets[0].pending).toBeUndefined();
  });

  it("omits x_fmt/y_fmt when both axes are auto (MAIN #24)", async () => {
    const { result } = renderHook(() => useFigureBuilder());
    await act(async () => {
      await result.current.exportNow();
    });
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.x_fmt).toBeUndefined();
    expect(body.y_fmt).toBeUndefined();
  });

  it("sends the live x_fmt/y_fmt when non-auto (MAIN #24)", async () => {
    useApp.setState({
      xFmt: { mode: "fixed", digits: 3 },
      yFmt: { mode: "sci", digits: 1 },
    });
    const { result } = renderHook(() => useFigureBuilder());
    await act(async () => {
      await result.current.exportNow();
    });
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.x_fmt).toEqual({ mode: "fixed", digits: 3 });
    expect(body.y_fmt).toEqual({ mode: "sci", digits: 1 });
  });

  it("restores a FigureDoc's display-ordered series styles into preview and export", async () => {
    useApp.setState({
      figureDocSeed: {
        id: "draft",
        name: "Point plot",
        datasetId: "d1",
        live: true,
        config: {
          xKey: null,
          yKeys: [1],
          xScale: "linear",
          yScale: "linear",
          title: "",
          xLabel: "",
          yLabel: "",
          style: "default",
          fmt: "pdf",
          dpi: 300,
          overrides: null,
          seriesStyles: [{ color: "#123456", line: "none", marker: true }],
        },
      },
    });
    const { result } = renderHook(() => useFigureBuilder());
    await waitFor(() => expect(renderFigureHitmap).toHaveBeenCalled());
    const preview = vi.mocked(renderFigureHitmap).mock.calls.at(-1)?.[0];
    expect(preview?.series_styles).toEqual([{ color: "#123456", line: "none", marker: true }]);
    expect(useApp.getState().figureDocSeed).toBeNull();

    await act(async () => result.current.exportNow());
    expect(vi.mocked(exportFigure).mock.calls.at(-1)?.[0].series_styles).toEqual([
      { color: "#123456", line: "none", marker: true },
    ]);
  });

  // GUI_INTERACTION #12 Slice 5: a grouped FigureDoc (the Graph Builder
  // handoff, plotSpecToFigureDoc) carries config.groupCol through the SAME
  // preview/export request path as every other doc field -- opening,
  // previewing, exporting, and re-saving must all thread it.
  it("threads a grouped FigureDoc's groupCol through preview, export, and re-save", async () => {
    useApp.setState({
      figureDocSeed: {
        id: "draft",
        name: "Grouped plot",
        datasetId: "d1",
        live: true,
        config: {
          xKey: null,
          yKeys: [0],
          groupCol: 1,
          xScale: "linear",
          yScale: "linear",
          title: "",
          xLabel: "",
          yLabel: "",
          style: "default",
          fmt: "pdf",
          dpi: 300,
          overrides: null,
          seriesStyles: null,
        },
      },
    });
    const { result } = renderHook(() => useFigureBuilder());
    await waitFor(() => expect(renderFigureHitmap).toHaveBeenCalled());
    const preview = vi.mocked(renderFigureHitmap).mock.calls.at(-1)?.[0];
    expect(preview?.group_col).toBe(1);

    await act(async () => result.current.exportNow());
    expect(vi.mocked(exportFigure).mock.calls.at(-1)?.[0].group_col).toBe(1);

    act(() => result.current.saveAsFigure("Re-saved", true));
    const saved = useApp.getState().figureDocs.at(-1);
    expect(saved?.config.groupCol).toBe(1);
  });

  it("a plain (non-doc-seeded) builder sends no group_col", async () => {
    const { result } = renderHook(() => useFigureBuilder());
    await act(async () => {
      await result.current.exportNow();
    });
    expect(vi.mocked(exportFigure).mock.calls[0][0].group_col).toBeUndefined();
  });

  it("syncs DPI to the preset's calibrated value when the style changes", () => {
    const { result } = renderHook(() => useFigureBuilder());
    expect(result.current.dpi).toBe(FIGURE_STYLE_DPI.default);

    act(() => result.current.setStyle("aps"));
    expect(result.current.style).toBe("aps");
    expect(result.current.dpi).toBe(600); // FIGURE_STYLE_DPI.aps

    act(() => result.current.setStyle("web"));
    expect(result.current.dpi).toBe(150); // FIGURE_STYLE_DPI.web
  });

  it("still lets the user override DPI after a preset sync", () => {
    const { result } = renderHook(() => useFigureBuilder());
    act(() => result.current.setStyle("nature"));
    expect(result.current.dpi).toBe(600);

    act(() => result.current.setDpi(1200));
    expect(result.current.dpi).toBe(1200); // manual override sticks

    act(() => result.current.setFmt("png")); // unrelated change doesn't reset it
    expect(result.current.dpi).toBe(1200);
  });

  it("reports a canonical document's missing live source instead of falling back to the active dataset", async () => {
    const document = createFigureDocument({
      id: "missing-source",
      name: "Missing source",
      datasetId: "gone",
      view: defaultPlotView(),
    });
    useApp.setState({
      figurePublicationSession: { target: "window", windowId: "w1", baseline: structuredClone(document), draft: structuredClone(document) },
    });
    const { result } = renderHook(() => useFigureBuilder());

    expect(result.current.canonicalReadiness).toBe("missing-source");
    expect(result.current.error).toContain("source unavailable");
    // The message must stay actionable and must NOT leak the raw internal
    // dataset id (item 14) — it used to read `...requires dataset "gone"`.
    expect(result.current.error).not.toContain("gone");
    expect(result.current.error).toBe(
      "source unavailable: this figure's dataset is not loaded — re-import it to preview or export",
    );
    expect(result.current.data).toBeNull();
    expect(result.current.canExport).toBe(false);
    expect(renderFigureHitmap).not.toHaveBeenCalled();
    await act(async () => result.current.exportNow());
    expect(exportFigure).not.toHaveBeenCalled();
  });

  it("allows unchanged detached drafts only while their canonical source is ready", () => {
    const document = createFigureDocument({
      id: "detached", name: "Detached", datasetId: "d1", view: defaultPlotView(),
    });
    useApp.setState({
      figurePublicationSession: {
        target: "new-editable", windowId: null,
        baseline: structuredClone(document), draft: structuredClone(document),
      },
    });
    const { result } = renderHook(() => useFigureBuilder());
    expect(result.current.dirty).toBe(false);
    expect(result.current.canApply).toBe(true);

    act(() => useApp.setState({ datasets: [], activeId: null }));
    expect(result.current.canonicalReadiness).toBe("missing-source");
    expect(result.current.canApply).toBe(false);
  });

  it("reports an incompatible canonical spec while retaining its resolved source data", () => {
    const document = createFigureDocument({
      id: "grouped-y2",
      name: "Grouped y2",
      datasetId: "d1",
      view: { ...defaultPlotView(), yKeys: [0], y2Keys: [0] },
      groupKey: 0,
    });
    useApp.setState({
      figurePublicationSession: { target: "window", windowId: "w1", baseline: structuredClone(document), draft: structuredClone(document) },
    });
    const { result } = renderHook(() => useFigureBuilder());

    expect(result.current.canonicalReadiness).toBe("invalid-spec");
    expect(result.current.error).toContain("figure configuration is not previewable");
    expect(result.current.error).toContain("grouped figures cannot use a secondary Y axis");
    expect(result.current.data).toEqual(DATA);
    expect(result.current.canExport).toBe(false);
    expect(renderFigureHitmap).not.toHaveBeenCalled();
  });

  it("renders and patches one canonical draft without dropping rich document state", async () => {
    const document = createFigureDocument({
      id: "figure-w1", name: "Canonical", datasetId: "d1",
      view: { ...defaultPlotView(), yKeys: [0, 1], y2Keys: [0], y2Scale: "log", plotTitle: "Before" },
      mark: "scatter",
      facetKey: 1,
      errors: [{ target: 1, channel: 0, axis: "y", side: "+" }],
      axisBreaks: { x: [[0.2, 0.5]], y: [[1, 2]], y2: [[3, 4]] },
      publication: { overrides: { font_name: "Helvetica" } },
    });
    useApp.setState({ figurePublicationSession: { target: "window", windowId: "w1", baseline: structuredClone(document), draft: structuredClone(document) } });
    const { result } = renderHook(() => useFigureBuilder());
    await waitFor(() => expect(renderFigureHitmap).toHaveBeenCalled());
    await waitFor(() => expect(result.current.hitmap).not.toBeNull());
    expect(vi.mocked(renderFigureHitmap).mock.calls.at(-1)?.[0]).toMatchObject({
      y2_keys: [0], overrides: { x_breaks: [[0.2, 0.5]] }, error_spans: [null, null],
    });

    act(() => {
      result.current.setFmt("svg");
      result.current.editElementText("title", "Edited");
      result.current.dragElement("legend", 300, 200);
    });
    const draft = useApp.getState().figurePublicationSession!.draft;
    expect(draft.output.format).toBe("svg");
    expect(draft.plot.view.plotTitle).toBe("Edited");
    expect(draft.publication?.overrides?.legend).toMatchObject({ loc: "custom" });
    expect(draft.bindings.y2Keys).toEqual([0]);
    expect(draft.bindings.errors).toEqual(document.bindings.errors);
    expect(draft.bindings.facetKey).toBe(1);
    expect(draft.plot.mark).toBe("scatter");
    expect(draft.plot.axisBreaks).toEqual(document.plot.axisBreaks);

    act(() => result.current.setOverrides({
      ...result.current.overrides,
      y2_lim: [10, 20],
      legend: { ...result.current.overrides.legend, title: "Secondary" },
      annotations: [{
        text: "Callout",
        x: 0.2,
        y: 0.8,
        size: 11,
        anchor: "page",
        frame: { fill: "#fff", stroke: "#111", opacity: 0.5, pad: 3 },
      }],
      x_breaks: [[0.25, 0.5]],
    }));
    expect(useApp.getState().figurePublicationSession?.draft.publication?.overrides).toMatchObject({
      y2_lim: [10, 20],
      legend: { title: "Secondary" },
      annotations: [{
        text: "Callout",
        x: 0.2,
        y: 0.8,
        size: 11,
        anchor: "page",
        frame: { fill: "#fff", stroke: "#111", opacity: 0.5, pad: 3 },
      }],
      x_breaks: [[0.25, 0.5]],
    });
  });

  // Regression: canonical mode read/wrote ONLY `publication.overrides` (the
  // publication-only delta), but the preview renders the MERGE of that delta
  // with view-derived overrides (`lib/figureSpec.ts`'s `buildFigureSpecForView`
  // -> `mergeFigureOverrides(withBreaks, extras.publicationOverrides)`). A
  // view-derived annotation (added on the Stage, no publication overrides yet)
  // was therefore invisible to the property panels and un-draggable — `dragElement`
  // length-checked against `activeOverrides.annotations` which was always [].
  it("reads canonical annotations through the view-derived merge and lets drag reach them", async () => {
    const document = createFigureDocument({
      id: "figure-ann",
      name: "Annotated",
      datasetId: "d1",
      view: { ...defaultPlotView(), annotations: [{ id: "a1", x: 1, y: 2, text: "Hello" }] },
    });
    useApp.setState({
      figurePublicationSession: {
        target: "window", windowId: "w1",
        baseline: structuredClone(document), draft: structuredClone(document),
      },
    });
    const { result } = renderHook(() => useFigureBuilder());
    await waitFor(() => expect(renderFigureHitmap).toHaveBeenCalled());
    await waitFor(() => expect(result.current.hitmap).not.toBeNull());

    // The view-derived annotation must be visible to the property panels —
    // publication.overrides is absent, so the pre-fix read (`publication
    // .overrides ?? overrides`) always saw [].
    expect(result.current.overrides.annotations).toHaveLength(1);

    // Drag must reach it too, not silently no-op against that same empty list.
    const axes = result.current.hitmap!.axes;
    const expected = pxToData(axes, 350, 150);
    act(() => result.current.dragElement("ann:0", 350, 150));
    const draft = useApp.getState().figurePublicationSession!.draft;
    expect(draft.publication?.overrides?.annotations?.[0]).toMatchObject({
      x: expected.x,
      y: expected.y,
      text: "Hello",
    });
  });

  // Regression (write side): the pre-fix `setCanonicalOverrides` wrote
  // `compactOverrides(next)` verbatim, so ANY panel edit pinned the entire
  // merged snapshot (including view-derived annotations/x_lim) into
  // publication.overrides — freezing fields the user never touched instead
  // of leaving them tracking the view.
  it("writes only the changed top-level override key, leaving untouched view-derived keys out of the publication delta", async () => {
    const document = createFigureDocument({
      id: "figure-grid",
      name: "Grid edit",
      datasetId: "d1",
      view: {
        ...defaultPlotView(),
        annotations: [{ id: "a1", x: 1, y: 2, text: "Hello" }],
        xLim: [0, 10],
      },
    });
    useApp.setState({
      figurePublicationSession: {
        target: "window", windowId: "w1",
        baseline: structuredClone(document), draft: structuredClone(document),
      },
    });
    const { result } = renderHook(() => useFigureBuilder());
    await waitFor(() => expect(renderFigureHitmap).toHaveBeenCalled());

    act(() => result.current.setOverrides({ ...result.current.overrides, grid: false }));
    const overrides = useApp.getState().figurePublicationSession!.draft.publication?.overrides;
    expect(overrides).toMatchObject({ grid: false });
    expect(overrides).not.toHaveProperty("annotations");
    expect(overrides).not.toHaveProperty("x_lim");
  });

  // Review finding #3: a window-target session outlives its target window
  // closing or losing focus, and the bridge in applyFigurePublicationEdit
  // requires the EXACT focused window — without this, Apply stays enabled
  // and silently no-ops forever.
  describe("window-target liveness", () => {
    const win = (id: string): PlotWindow => ({
      id, kind: "plot", title: id, datasetId: "d1",
      geometry: { x: 0, y: 0, w: 400, h: 300 }, z: 1, winState: "normal",
      view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
    });
    const session = (windowId: string, dirty: boolean) => {
      const baseline = createFigureDocument({ id: "figure-w1", name: "Live plot", datasetId: "d1", view: defaultPlotView() });
      const draft = dirty ? { ...baseline, name: "Edited" } : baseline;
      return { target: "window" as const, windowId, baseline, draft };
    };

    it("blocks Apply with a reason once the target window is closed", async () => {
      useApp.setState({ figurePublicationSession: session("w1", true), plotWindows: [], focusedWindowId: null });
      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(renderFigureHitmap).toHaveBeenCalled());

      expect(result.current.canApply).toBe(false);
      expect(result.current.applyBlockedReason).toBe("focus the previewed plot window to apply");
    });

    it("blocks Apply with a reason when the target window exists but isn't focused", async () => {
      useApp.setState({
        figurePublicationSession: session("w1", true),
        plotWindows: [win("w1"), win("w2")],
        focusedWindowId: "w2",
      });
      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(renderFigureHitmap).toHaveBeenCalled());

      expect(result.current.canApply).toBe(false);
      expect(result.current.applyBlockedReason).toBe("focus the previewed plot window to apply");
    });

    it("allows Apply with no blocked reason once the target window is focused", async () => {
      useApp.setState({
        figurePublicationSession: session("w1", true),
        plotWindows: [win("w1")],
        focusedWindowId: "w1",
      });
      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(renderFigureHitmap).toHaveBeenCalled());

      expect(result.current.canApply).toBe(true);
      expect(result.current.applyBlockedReason).toBeNull();
    });

    it("blocks Apply with the drift reason once the session is flagged staleBaseline, even while focused", async () => {
      useApp.setState({
        figurePublicationSession: { ...session("w1", true), staleBaseline: true },
        plotWindows: [win("w1")],
        focusedWindowId: "w1",
      });
      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(renderFigureHitmap).toHaveBeenCalled());

      expect(result.current.canApply).toBe(false);
      expect(result.current.applyBlockedReason).toContain("Cancel and reopen Publication Preview");
    });

    // Item 1: proactive drift detection. Today the store only discovers a
    // Stage edit made behind the open, non-modal preview dialog when the
    // user clicks Apply (the staleBaseline test above). This must catch it
    // on its own render instead.
    it("blocks Apply and reports drift once the window's document changes behind the open dialog", async () => {
      const s = session("w1", true);
      const focusedDocument = structuredClone(s.baseline);
      // liveWindowDocument uses window.title (not document.name) as the live
      // document's name for a focused window -- keep it matching the
      // baseline's name, and the singleton view fields matching
      // defaultPlotView() (what the baseline's view was built from), so
      // nothing has drifted yet.
      const focused: PlotWindow = { ...win("w1"), title: s.baseline.name, document: focusedDocument };
      useApp.setState({ ...defaultPlotView(), figurePublicationSession: s, plotWindows: [focused], focusedWindowId: "w1" });
      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(renderFigureHitmap).toHaveBeenCalled());

      // Sanity: nothing has drifted yet, so the dirty+focused session is applyable.
      expect(result.current.canApply).toBe(true);
      expect(result.current.applyBlockedReason).toBeNull();

      const driftedDocument = {
        ...focusedDocument,
        plot: { ...focusedDocument.plot, axisBreaks: { x: [[1, 2]] as [number, number][], y: [], y2: [] } },
      };
      act(() => {
        useApp.setState({ plotWindows: [{ ...focused, document: driftedDocument }] });
      });

      expect(result.current.canApply).toBe(false);
      expect(result.current.applyBlockedReason).toBe(
        "the plot changed while previewing — Cancel and reopen Publication Preview to pick up the changes",
      );
    });

    it("does not report drift when the window's live document still matches the session baseline", async () => {
      const s = session("w1", true);
      const focused: PlotWindow = { ...win("w1"), title: s.baseline.name, document: structuredClone(s.baseline) };
      useApp.setState({ ...defaultPlotView(), figurePublicationSession: s, plotWindows: [focused], focusedWindowId: "w1" });
      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(renderFigureHitmap).toHaveBeenCalled());

      expect(result.current.canApply).toBe(true);
      expect(result.current.applyBlockedReason).toBeNull();
    });
  });

  // Item 3: x-axis breaks unify on one canonical home
  // (canonicalOverrides.ts's effectiveXBreaks/migrateXBreaksPatch); these
  // exercise the hook's wiring on top of those pure functions.
  describe("canonical x-axis breaks (item 3)", () => {
    it("a canonical axisBreaks.x with no publication delta is the source, and an edit writes it straight back", async () => {
      const document = createFigureDocument({
        id: "figure-breaks-a", name: "Breaks A", datasetId: "d1", view: defaultPlotView(),
        axisBreaks: { x: [[1, 2]] },
      });
      useApp.setState({
        figurePublicationSession: { target: "window", windowId: "w1", baseline: structuredClone(document), draft: structuredClone(document) },
      });
      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(renderFigureHitmap).toHaveBeenCalled());

      expect(result.current.xBreaks).toEqual([[1, 2]]);

      act(() => result.current.setXBreaks!([[1, 2], [5, 6]]));
      const draft = useApp.getState().figurePublicationSession!.draft;
      expect(draft.plot.axisBreaks.x).toEqual([[1, 2], [5, 6]]);
      expect(draft.publication?.overrides?.x_breaks).toBeUndefined();

      // Sanity: buildFigureSpecFromDocument emits axisBreaks.x as
      // overrides.x_breaks -- the rendered spec must agree with the panel.
      await waitFor(() => {
        const last = vi.mocked(renderFigureHitmap).mock.calls.at(-1)?.[0];
        expect(last?.overrides?.x_breaks).toEqual([[1, 2], [5, 6]]);
      });
    });

    it("a legacy-imported publication.overrides.x_breaks is the effective source, and an edit migrates it into axisBreaks.x", async () => {
      const document = createFigureDocument({
        id: "figure-breaks-b", name: "Breaks B", datasetId: "d1", view: defaultPlotView(),
        axisBreaks: { x: [[9, 9.5]] }, // stale canonical value, shadowed by the publication delta
        publication: { overrides: { x_breaks: [[1, 2]], font_name: "Times" } },
      });
      useApp.setState({
        figurePublicationSession: { target: "window", windowId: "w1", baseline: structuredClone(document), draft: structuredClone(document) },
      });
      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(renderFigureHitmap).toHaveBeenCalled());

      expect(result.current.xBreaks).toEqual([[1, 2]]);

      act(() => result.current.setXBreaks!([[3, 4]]));
      const draft = useApp.getState().figurePublicationSession!.draft;
      expect(draft.plot.axisBreaks.x).toEqual([[3, 4]]);
      expect(draft.publication?.overrides?.x_breaks).toBeUndefined();
      expect(draft.publication?.overrides?.font_name).toBe("Times"); // untouched sibling key survives

      await waitFor(() => {
        const last = vi.mocked(renderFigureHitmap).mock.calls.at(-1)?.[0];
        expect(last?.overrides?.x_breaks).toEqual([[3, 4]]);
      });
    });

    it("leaves xBreaks/setXBreaks undefined in legacy (non-canonical) mode", () => {
      const { result } = renderHook(() => useFigureBuilder());
      expect(result.current.xBreaks).toBeUndefined();
      expect(result.current.setXBreaks).toBeUndefined();
    });
  });
});
