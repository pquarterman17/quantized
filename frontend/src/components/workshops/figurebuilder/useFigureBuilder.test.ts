import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigure, fetchBookData, renderFigureHitmap } from "../../../lib/api";
import {
  createFigureDocument,
  deserializeFigureDocument,
  figureDocumentToPlotView,
  serializeFigureDocument,
} from "../../../lib/figureDocument";
import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import { pxToData, type FigureHitmap } from "../../../lib/previewmap";
import type { DataStruct, Shape } from "../../../lib/types";
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
    await waitFor(() => expect(result.current.preview).not.toBeNull());
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
    await waitFor(() => expect(result.current.preview).not.toBeNull());
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
    await waitFor(() => expect(result.current.preview).not.toBeNull());
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
    await waitFor(() => expect(result.current.preview).not.toBeNull());
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
    await waitFor(() => expect(result.current.preview).not.toBeNull());

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
      await waitFor(() => expect(result.current.preview).not.toBeNull());

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
      await waitFor(() => expect(result.current.preview).not.toBeNull());

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
      await waitFor(() => expect(result.current.preview).not.toBeNull());

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
      await waitFor(() => expect(result.current.preview).not.toBeNull());

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
      await waitFor(() => expect(result.current.preview).not.toBeNull());

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

    // The test above drifts the WINDOW RECORD (`plotWindows`), which the hook
    // subscribes to -- so it proves the drift COMPUTATION but never the
    // SUBSCRIPTION. Real Stage edits don't work that way: `refLines`,
    // `regionShades`, `shapes`, `annotations`, `hiddenChannels`, `plotTitle`
    // and every other live-view field is a top-level store singleton that the
    // focused window's document is derived FROM (liveWindowDocument ->
    // snapshotView), not a field on the window record. The hook subscribes to
    // none of them, so the pre-emptive check never re-ran and Apply stayed
    // enabled until the user clicked it and had the whole session rejected.
    // Verified against the running app before this test was written: add a
    // reference line on the Stage behind an open preview, Apply stays enabled,
    // click it -> "publication preview target changed; changes not applied"
    // and every preview edit is lost.
    it("blocks Apply once a LIVE VIEW field the hook does not subscribe to drifts (reference lines)", async () => {
      const s = session("w1", true);
      const focused: PlotWindow = { ...win("w1"), title: s.baseline.name, document: structuredClone(s.baseline) };
      useApp.setState({ ...defaultPlotView(), figurePublicationSession: s, plotWindows: [focused], focusedWindowId: "w1" });
      const { result } = renderHook(() => useFigureBuilder());
      // Wait on the STATE the debounced render produces, not on the mock
      // being called (TEST_DETERMINISM #5/#6) — `preview` is the resolved
      // hit-map's data URL, so this cannot pass before the render settles.
      await waitFor(() => expect(result.current.preview).not.toBeNull());

      expect(result.current.canApply).toBe(true);

      // Exactly what Inspector/RefLinesCard's "Add" does — no window record
      // is touched, so nothing the hook selects on changes identity.
      act(() => {
        useApp.setState({ refLines: [{ id: "ref-1", axis: "x", value: 500 }] });
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
      await waitFor(() => expect(result.current.preview).not.toBeNull());

      expect(result.current.canApply).toBe(true);
      expect(result.current.applyBlockedReason).toBeNull();
    });
  });

  // Edit a SAVED editable figure directly in Publication Preview -- no plot
  // window required -- with Apply replacing that same Library entry in
  // place. The `library` session target is deliberately transparent to this
  // hook: `canonical` (session !== null), `targetBlocked` (only checked for
  // `window`), and `canApply`'s dirty-check branch (only `new-editable`
  // skips it) all already treat `library` exactly like `window` with no code
  // changes here -- this end-to-end pass is what proves that.
  describe("library-target Apply (edit a saved figure in place)", () => {
    const savedFigure = (id: string) => createFigureDocument({
      id, name: "Library figure", datasetId: "d1", view: defaultPlotView(),
    });

    it("edits a saved figure end-to-end: Apply replaces the SAME Library entry as one undoable edit", async () => {
      const saved = savedFigure("figure-lib-e2e");
      useApp.setState({ editableFigures: [saved] });
      const history = useApp.getState().history.length;
      expect(useApp.getState().beginFigurePublicationEditForFigure("figure-lib-e2e")).toBe(true);

      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(result.current.preview).not.toBeNull());
      expect(result.current.publicationTarget).toBe("library");
      act(() => result.current.setTitle("Edited title"));
      expect(result.current.dirty).toBe(true);

      act(() => {
        result.current.apply();
      });

      const state = useApp.getState();
      expect(state.figurePublicationSession).toBeNull();
      expect(state.editableFigures).toHaveLength(1); // replaced, never duplicated
      expect(state.editableFigures[0]).toMatchObject({
        id: "figure-lib-e2e",
        plot: { view: { plotTitle: "Edited title" } },
      });
      expect(state.history).toHaveLength(history + 1);
    });

    it("Cancel leaves the Library entry untouched", async () => {
      const saved = savedFigure("figure-lib-e2e-cancel");
      useApp.setState({ editableFigures: [saved] });
      const before = structuredClone(useApp.getState().editableFigures);
      const history = useApp.getState().history.length;
      useApp.getState().beginFigurePublicationEditForFigure("figure-lib-e2e-cancel");

      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(result.current.preview).not.toBeNull());
      act(() => result.current.setTitle("Discarded"));

      act(() => {
        result.current.cancel();
      });

      const state = useApp.getState();
      expect(state.figurePublicationSession).toBeNull();
      expect(state.editableFigures).toEqual(before);
      expect(state.history).toHaveLength(history);
    });
  });

  // F2.3b: per-series properties (color/width/mode, visibility, order) live
  // straight on document.plot.view — these exercise the hook's setters, plus
  // the required Apply-commits/Cancel-is-mutation-free pin.
  describe("canonical per-series properties (F2.3b)", () => {
    const win = (id: string, document?: ReturnType<typeof createFigureDocument>): PlotWindow => ({
      // liveWindowDocument names the "live" document from window.title
      // (updateFigureDocumentFromPlotView's `name: window.title`) -- it must
      // match the document's own name or Apply sees a name drift and rejects.
      id, kind: "plot", title: document?.name ?? id, datasetId: "d1",
      geometry: { x: 0, y: 0, w: 400, h: 300 }, z: 1, winState: "normal",
      view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
      ...(document ? { document } : {}),
    });
    const twoChannelDocument = (id: string) => createFigureDocument({
      id, name: "Series doc", datasetId: "d1", view: { ...defaultPlotView(), yKeys: [0, 1] },
    });

    it("computes an empty channel list in legacy (non-canonical) mode", () => {
      const { result } = renderHook(() => useFigureBuilder());
      expect(result.current.seriesChannels).toEqual([]);
      expect(result.current.seriesStyles).toEqual({});
      expect(result.current.hiddenChannels).toEqual([]);
    });

    it("computes the display-order channel list from bindings + seriesOrder once canonical", () => {
      const document = twoChannelDocument("figure-series-a");
      useApp.setState({
        figurePublicationSession: { target: "window", windowId: "w1", baseline: structuredClone(document), draft: structuredClone(document) },
      });
      const { result } = renderHook(() => useFigureBuilder());
      expect(result.current.seriesChannels).toEqual([0, 1]);
    });

    it("setSeriesStyle merges a per-channel patch without disturbing sibling channels", () => {
      const document = createFigureDocument({
        id: "figure-series-b", name: "Series doc", datasetId: "d1",
        view: { ...defaultPlotView(), yKeys: [0, 1], seriesStyles: { 0: { color: "--series-2" } } },
      });
      useApp.setState({
        figurePublicationSession: { target: "window", windowId: "w1", baseline: structuredClone(document), draft: structuredClone(document) },
      });
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.setSeriesStyle(1, { width: 3 }));
      expect(useApp.getState().figurePublicationSession!.draft.plot.view.seriesStyles).toEqual({
        0: { color: "--series-2" },
        1: { width: 3 },
      });
    });

    it("setSeriesHidden toggles one channel's visibility on and off", () => {
      const document = twoChannelDocument("figure-series-c");
      useApp.setState({
        figurePublicationSession: { target: "window", windowId: "w1", baseline: structuredClone(document), draft: structuredClone(document) },
      });
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.setSeriesHidden(0, true));
      expect(useApp.getState().figurePublicationSession!.draft.plot.view.hiddenChannels).toEqual([0]);
      act(() => result.current.setSeriesHidden(0, false));
      expect(useApp.getState().figurePublicationSession!.draft.plot.view.hiddenChannels).toEqual([]);
    });

    it("moveSeries swaps two adjacent channels' display order", () => {
      const document = twoChannelDocument("figure-series-d");
      useApp.setState({
        figurePublicationSession: { target: "window", windowId: "w1", baseline: structuredClone(document), draft: structuredClone(document) },
      });
      const { result } = renderHook(() => useFigureBuilder());
      expect(result.current.seriesChannels).toEqual([0, 1]);
      act(() => result.current.moveSeries(1, -1));
      expect(useApp.getState().figurePublicationSession!.draft.plot.view.seriesOrder).toEqual([1, 0]);
    });

    it("Apply commits series edits into the window document and the legacy facade", async () => {
      const document = twoChannelDocument("figure-series-e");
      useApp.setState({
        // applyFigurePublicationEdit resolves the FOCUSED window's "live"
        // document from the store's top-level ambient PlotView fields
        // (liveWindowDocument -> updateFigureDocumentFromPlotView), not from
        // window.document.plot.view -- these must mirror the baseline's view
        // (defaultPlotView() + yKeys) or Apply rejects as drifted.
        ...defaultPlotView(),
        yKeys: [0, 1],
        figurePublicationSession: { target: "window", windowId: "w1", baseline: structuredClone(document), draft: structuredClone(document) },
        plotWindows: [win("w1", structuredClone(document))],
        focusedWindowId: "w1",
      });
      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(result.current.preview).not.toBeNull());
      act(() => {
        result.current.setSeriesStyle(0, { color: "--series-5", width: 2 });
        result.current.setSeriesHidden(1, true);
        result.current.moveSeries(1, -1);
      });
      act(() => {
        result.current.apply();
      });

      const state = useApp.getState();
      expect(state.figurePublicationSession).toBeNull();
      expect(state.plotWindows[0].document?.plot.view).toMatchObject({
        seriesStyles: { 0: { color: "--series-5", width: 2 } },
        hiddenChannels: [1],
        seriesOrder: [1, 0],
      });
      // hydrateView spreads the applied view onto the legacy top-level facade
      // fields too (the same fields SeriesStyleCard/PlotObjectsCard read).
      expect(state.seriesStyles).toEqual({ 0: { color: "--series-5", width: 2 } });
      expect(state.hiddenChannels).toEqual([1]);
      expect(state.seriesOrder).toEqual([1, 0]);
    });

    it("Cancel makes no persistent mutation", () => {
      const document = twoChannelDocument("figure-series-f");
      useApp.setState({
        figurePublicationSession: { target: "window", windowId: "w1", baseline: structuredClone(document), draft: structuredClone(document) },
        plotWindows: [win("w1", structuredClone(document))],
        focusedWindowId: "w1",
      });
      const before = structuredClone(useApp.getState().plotWindows);
      const { result } = renderHook(() => useFigureBuilder());
      act(() => {
        result.current.setSeriesStyle(0, { color: "--series-5" });
        result.current.setSeriesHidden(1, true);
      });
      act(() => {
        result.current.cancel();
      });
      const state = useApp.getState();
      expect(state.figurePublicationSession).toBeNull();
      expect(state.plotWindows).toEqual(before);
    });
  });

  // F2.3c: drawn shapes (color/fill/opacity/width/dash, plus remove) live
  // straight on document.plot.view.shapes -- the SAME kind of field as
  // F2.3b's series properties above, so this mirrors that block's coverage:
  // the hook's setters, plus the required Apply-commits/Cancel-is-mutation-
  // free pin, plus a serialize/deserialize round trip (shapes has no schema
  // change of its own -- PlotView already carried it losslessly, F1.2).
  describe("canonical drawn shapes (F2.3c)", () => {
    const win = (id: string, document?: ReturnType<typeof createFigureDocument>): PlotWindow => ({
      id, kind: "plot", title: document?.name ?? id, datasetId: "d1",
      geometry: { x: 0, y: 0, w: 400, h: 300 }, z: 1, winState: "normal",
      view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
      ...(document ? { document } : {}),
    });
    const shape = (id: string, kind: Shape["kind"] = "arrow"): Shape => ({ id, kind, x1: 0, y1: 0, x2: 1, y2: 1 });
    const shapesDocument = (id: string, shapes: Shape[]) => createFigureDocument({
      id, name: "Shapes doc", datasetId: "d1", view: { ...defaultPlotView(), shapes },
    });

    it("computes an empty shapes list in legacy (non-canonical) mode", () => {
      const { result } = renderHook(() => useFigureBuilder());
      expect(result.current.shapes).toEqual([]);
      expect(result.current.shapeRows).toEqual([]);
    });

    it("exposes the draft's shapes + kind-scoped rows once canonical", () => {
      const document = shapesDocument("figure-shapes-a", [shape("s1", "arrow"), shape("s2", "rect")]);
      useApp.setState({
        figurePublicationSession: { target: "window", windowId: "w1", baseline: structuredClone(document), draft: structuredClone(document) },
      });
      const { result } = renderHook(() => useFigureBuilder());
      expect(result.current.shapes).toHaveLength(2);
      expect(result.current.shapeRows).toEqual([
        { id: "s1", kind: "arrow", label: "arrow 1" },
        { id: "s2", kind: "rect", label: "rect 1" },
      ]);
    });

    it("setShapeStyle merges a patch into the one shape matching id, leaving siblings untouched", () => {
      const document = shapesDocument("figure-shapes-b", [shape("s1", "arrow"), shape("s2", "rect")]);
      useApp.setState({
        figurePublicationSession: { target: "window", windowId: "w1", baseline: structuredClone(document), draft: structuredClone(document) },
      });
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.setShapeStyle("s2", { stroke: "--series-4", width: 2 }));
      expect(useApp.getState().figurePublicationSession!.draft.plot.view.shapes).toEqual([
        shape("s1", "arrow"),
        { ...shape("s2", "rect"), stroke: "--series-4", width: 2 },
      ]);
    });

    it("removeShape drops the matching shape and leaves siblings untouched", () => {
      const document = shapesDocument("figure-shapes-c", [shape("s1", "arrow"), shape("s2", "rect")]);
      useApp.setState({
        figurePublicationSession: { target: "window", windowId: "w1", baseline: structuredClone(document), draft: structuredClone(document) },
      });
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.removeShape("s1"));
      expect(useApp.getState().figurePublicationSession!.draft.plot.view.shapes).toEqual([shape("s2", "rect")]);
    });

    it("Apply commits shape edits into the window document and the legacy facade", async () => {
      const document = shapesDocument("figure-shapes-d", [shape("s1", "arrow")]);
      useApp.setState({
        // Mirrors F2.3b's Apply test: the store's top-level ambient PlotView
        // fields must match the baseline's view (defaultPlotView() + shapes)
        // or applyFigurePublicationEdit's liveWindowDocument sees drift and rejects.
        ...defaultPlotView(),
        shapes: [shape("s1", "arrow")],
        figurePublicationSession: { target: "window", windowId: "w1", baseline: structuredClone(document), draft: structuredClone(document) },
        plotWindows: [win("w1", structuredClone(document))],
        focusedWindowId: "w1",
      });
      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(result.current.hitmap).not.toBeNull());
      act(() => {
        result.current.setShapeStyle("s1", { stroke: "--series-5", dash: true });
      });
      act(() => {
        result.current.apply();
      });

      const state = useApp.getState();
      expect(state.figurePublicationSession).toBeNull();
      expect(state.plotWindows[0].document?.plot.view.shapes).toEqual([
        { ...shape("s1", "arrow"), stroke: "--series-5", dash: true },
      ]);
      // hydrateView spreads the applied view onto the legacy top-level facade
      // too (the same field ShapesCard/Stage shape editing reads).
      expect(state.shapes).toEqual([{ ...shape("s1", "arrow"), stroke: "--series-5", dash: true }]);
    });

    it("Cancel makes no persistent mutation", () => {
      const document = shapesDocument("figure-shapes-e", [shape("s1", "arrow")]);
      useApp.setState({
        figurePublicationSession: { target: "window", windowId: "w1", baseline: structuredClone(document), draft: structuredClone(document) },
        plotWindows: [win("w1", structuredClone(document))],
        focusedWindowId: "w1",
      });
      const before = structuredClone(useApp.getState().plotWindows);
      const { result } = renderHook(() => useFigureBuilder());
      act(() => {
        result.current.setShapeStyle("s1", { width: 4 });
      });
      act(() => {
        result.current.cancel();
      });
      const state = useApp.getState();
      expect(state.figurePublicationSession).toBeNull();
      expect(state.plotWindows).toEqual(before);
    });

    it("an edited shape round-trips through document serialize/deserialize", () => {
      const document = shapesDocument("figure-shapes-f", [shape("s1", "rect")]);
      const editedShapes = [{ ...shape("s1", "rect"), fill: "--series-6", opacity: 0.6 }];
      const edited = {
        ...document,
        plot: { ...document.plot, view: { ...document.plot.view, shapes: editedShapes } },
      };
      const restored = deserializeFigureDocument(serializeFigureDocument(edited));
      expect(restored?.plot.view.shapes).toEqual(editedShapes);
    });

    // F2.4e: drag-to-move, the last F2.4 gesture. Mirrors F2.4d's drag block:
    // the hit element's index is the RENDER REQUEST's position, not the
    // draft's, and a shape translates by the pointer's DELTA (press origin
    // to drop point), never a jump. The mocked hit-map is 600x400 over
    // xlim/ylim [0,1] (top-of-file mock) — press (100,300) -> drop (220,100)
    // gives a clean data-coord delta of (+0.2, +0.5).
    describe("drag to move (F2.4e)", () => {
      const dragSession = async (shapes: Shape[]) => {
        const document = shapesDocument("figure-shapes-drag", shapes);
        useApp.setState({ ...defaultPlotView(), figurePublicationSession: { target: "window", windowId: "w1", baseline: structuredClone(document), draft: structuredClone(document) } });
        const { result } = renderHook(() => useFigureBuilder());
        await waitFor(() => expect(result.current.hitmap).not.toBeNull());
        return result;
      };
      const draftShapes = () =>
        useApp.getState().figurePublicationSession!.draft.plot.view.shapes;

      it("translates a data-anchored shape by the pointer's delta, preserving the grab offset", async () => {
        const result = await dragSession([{ ...shape("s1", "rect"), x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.3 }]);
        act(() => result.current.dragElement("shape:0", 220, 100, 100, 300));
        const s = draftShapes()[0];
        expect(s.x1).toBeCloseTo(0.3, 6);
        expect(s.y1).toBeCloseTo(0.6, 6);
        expect(s.x2).toBeCloseTo(0.5, 6);
        expect(s.y2).toBeCloseTo(0.8, 6);
      });

      it("translates a page-anchored shape in canvas fractions -- the OPPOSITE y-direction from a data anchor", async () => {
        const result = await dragSession([
          { ...shape("s1", "rect"), anchor: "page", x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.3 },
        ]);
        // Same press/drop as the data-anchor case above, but canvas fractions
        // have NO y-flip (px/width, py/height): dy is -0.5 here, not +0.5.
        act(() => result.current.dragElement("shape:0", 220, 100, 100, 300));
        const s = draftShapes()[0];
        expect(s.x1).toBeCloseTo(0.3, 6);
        expect(s.y1).toBeCloseTo(-0.4, 6);
        expect(s.x2).toBeCloseTo(0.5, 6);
        expect(s.y2).toBeCloseTo(-0.2, 6);
      });

      it("resolves the hit index through the render request's finite filter", async () => {
        // viewOverrides drops the non-finite shape, so element `shape:1` is
        // the THIRD draft shape; a bare index would drag the second.
        const bad: Shape = { id: "bad", kind: "rect", x1: 0, y1: 0, x2: Number.NaN, y2: 1 };
        const result = await dragSession([
          shape("a", "arrow"),
          bad,
          { ...shape("c", "rect"), x1: 0, y1: 0, x2: 0.2, y2: 0.2 },
        ]);
        act(() => result.current.dragElement("shape:1", 220, 100, 100, 300));
        expect(draftShapes()[0]).toEqual(shape("a", "arrow"));
        expect(draftShapes()[2].x1).toBeCloseTo(0.2, 6);
        expect(draftShapes()[2].y1).toBeCloseTo(0.5, 6);
      });

      it("ignores a drag on an element index no shape answers to", async () => {
        const result = await dragSession([shape("s1", "rect")]);
        act(() => result.current.dragElement("shape:7", 220, 100, 100, 300));
        expect(draftShapes()[0]).toEqual(shape("s1", "rect"));
      });

      it("no-ops without a press origin (the pre-F2.4e call shape)", async () => {
        const result = await dragSession([shape("s1", "rect")]);
        act(() => result.current.dragElement("shape:0", 220, 100));
        expect(draftShapes()[0]).toEqual(shape("s1", "rect"));
      });
    });
  });

  // F2.3d: reference lines live straight on document.plot.view.refLines --
  // the SAME kind of canonical-only field as F2.3b's series properties and
  // F2.3c's shapes, so this mirrors those blocks' coverage contract: the
  // hook's setters, the Apply-commits/Cancel-is-mutation-free pin, and a
  // serialize/deserialize round trip. The extra case here is ADD, which
  // shapes deliberately does not have (a reference line needs no live canvas).
  describe("canonical reference lines (F2.3d)", () => {
    const win = (id: string, document?: ReturnType<typeof createFigureDocument>): PlotWindow => ({
      id, kind: "plot", title: document?.name ?? id, datasetId: "d1",
      geometry: { x: 0, y: 0, w: 400, h: 300 }, z: 1, winState: "normal",
      view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
      ...(document ? { document } : {}),
    });
    const refLine = (id: string, axis: "x" | "y", value: number) => ({ id, axis, value });
    const refLineDocument = (id: string, refLines: ReturnType<typeof refLine>[]) => createFigureDocument({
      id, name: "Ref doc", datasetId: "d1", view: { ...defaultPlotView(), refLines },
    });
    const session = (document: ReturnType<typeof createFigureDocument>) => ({
      target: "window" as const, windowId: "w1",
      baseline: structuredClone(document), draft: structuredClone(document),
    });

    it("computes an empty reference-line list in legacy (non-canonical) mode", () => {
      const { result } = renderHook(() => useFigureBuilder());
      expect(result.current.refLines).toEqual([]);
    });

    it("exposes the draft's reference lines once canonical", () => {
      useApp.setState({ figurePublicationSession: session(refLineDocument("figure-ref-a", [refLine("r1", "x", 5)])) });
      const { result } = renderHook(() => useFigureBuilder());
      expect(result.current.refLines).toEqual([refLine("r1", "x", 5)]);
    });

    it("setRefLineValue patches the matching line only, leaving siblings untouched", () => {
      useApp.setState({
        figurePublicationSession: session(refLineDocument("figure-ref-b", [refLine("r1", "x", 5), refLine("r2", "y", 7)])),
      });
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.setRefLineValue("r2", 9));
      expect(useApp.getState().figurePublicationSession!.draft.plot.view.refLines).toEqual([
        refLine("r1", "x", 5),
        refLine("r2", "y", 9),
      ]);
    });

    it("addRefLine appends with a draft-namespaced id that cannot collide with the store's", () => {
      // useApp mints `ref-N` from its own module-global counter, which knows
      // nothing about a detached draft — a shared prefix would let a later
      // Stage "Add" re-mint an id this draft already applied.
      useApp.setState({ figurePublicationSession: session(refLineDocument("figure-ref-c", [refLine("ref-1", "x", 5)])) });
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.addRefLine("y", 12));
      expect(useApp.getState().figurePublicationSession!.draft.plot.view.refLines).toEqual([
        refLine("ref-1", "x", 5),
        refLine("pref-1", "y", 12),
      ]);
    });

    it("removeRefLine drops the matching line and leaves siblings untouched", () => {
      useApp.setState({
        figurePublicationSession: session(refLineDocument("figure-ref-d", [refLine("r1", "x", 5), refLine("r2", "y", 7)])),
      });
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.removeRefLine("r1"));
      expect(useApp.getState().figurePublicationSession!.draft.plot.view.refLines).toEqual([refLine("r2", "y", 7)]);
    });

    it("Apply commits reference-line edits into the window document and the legacy facade", async () => {
      const document = refLineDocument("figure-ref-e", [refLine("r1", "x", 5)]);
      useApp.setState({
        // Same requirement as F2.3b/F2.3c's Apply tests: the ambient PlotView
        // singletons must match the baseline's view or liveWindowDocument
        // sees drift and Apply rejects.
        ...defaultPlotView(),
        refLines: [refLine("r1", "x", 5)],
        figurePublicationSession: session(document),
        plotWindows: [win("w1", structuredClone(document))],
        focusedWindowId: "w1",
      });
      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(result.current.hitmap).not.toBeNull());
      act(() => result.current.setRefLineValue("r1", 42));
      act(() => result.current.addRefLine("y", -3));
      act(() => result.current.apply());

      const state = useApp.getState();
      expect(state.figurePublicationSession).toBeNull();
      expect(state.plotWindows[0].document?.plot.view.refLines).toEqual([
        refLine("r1", "x", 42),
        refLine("pref-1", "y", -3),
      ]);
      // hydrateView spreads the applied view onto the legacy top-level facade
      // too — the same field Inspector/RefLinesCard reads on the Stage.
      expect(state.refLines).toEqual([refLine("r1", "x", 42), refLine("pref-1", "y", -3)]);
    });

    it("Cancel makes no persistent mutation", () => {
      const document = refLineDocument("figure-ref-f", [refLine("r1", "x", 5)]);
      useApp.setState({
        figurePublicationSession: session(document),
        plotWindows: [win("w1", structuredClone(document))],
        focusedWindowId: "w1",
      });
      const before = structuredClone(useApp.getState().plotWindows);
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.addRefLine("y", 99));
      act(() => result.current.cancel());
      const state = useApp.getState();
      expect(state.figurePublicationSession).toBeNull();
      expect(state.plotWindows).toEqual(before);
    });

    it("edited reference lines round-trip through document serialize/deserialize", () => {
      const document = refLineDocument("figure-ref-g", [refLine("r1", "x", 5)]);
      const editedRefLines = [refLine("r1", "x", 42), refLine("pref-1", "y", -3)];
      const edited = {
        ...document,
        plot: { ...document.plot, view: { ...document.plot.view, refLines: editedRefLines } },
      };
      expect(deserializeFigureDocument(serializeFigureDocument(edited))?.plot.view.refLines).toEqual(editedRefLines);
    });

    // F2.4d: drag-to-move, the gesture the Stage canvas has always had. The
    // hit element's index is the RENDER REQUEST's position, not the draft's,
    // so these pin the mapping as well as the commit.
    describe("drag to move (F2.4d)", () => {
      const dragSession = async (lines: ReturnType<typeof refLine>[]) => {
        const document = refLineDocument("figure-ref-drag", lines);
        useApp.setState({ ...defaultPlotView(), figurePublicationSession: session(document) });
        const { result } = renderHook(() => useFigureBuilder());
        await waitFor(() => expect(result.current.hitmap).not.toBeNull());
        return result;
      };
      const draftRefLines = () =>
        useApp.getState().figurePublicationSession!.draft.plot.view.refLines;

      it("moves an X line to the dragged pixel's data X", async () => {
        const result = await dragSession([refLine("r1", "x", 5)]);
        // The mocked hit-map is 600x400 over xlim/ylim [0,1]; mid-width is x=0.5.
        act(() => result.current.dragElement("refline:0", 300, 200));
        expect(draftRefLines()[0].value).toBeCloseTo(0.5, 6);
      });

      it("moves a Y line by the dragged pixel's data Y, ignoring the horizontal component", async () => {
        // A line's axis is fixed everywhere in the app, so a sideways drag of
        // a Y line must not reinterpret it as an X line.
        const result = await dragSession([refLine("r1", "y", 5)]);
        act(() => result.current.dragElement("refline:0", 300, 100));
        expect(draftRefLines()[0].axis).toBe("y");
        expect(draftRefLines()[0].value).toBeCloseTo(0.75, 6);
      });

      it("resolves the hit index through the render request's finite filter", async () => {
        // viewOverrides drops the non-finite line, so element `refline:1` is
        // the THIRD draft line; a bare index would drag the second.
        const result = await dragSession([
          refLine("a", "x", 1),
          refLine("bad", "x", Number.NaN),
          refLine("c", "x", 3),
        ]);
        act(() => result.current.dragElement("refline:1", 300, 200));
        expect(draftRefLines()[2].value).toBeCloseTo(0.5, 6);
        expect(draftRefLines()[0].value).toBe(1);
      });

      it("ignores a drag on an element index no line answers to", async () => {
        const result = await dragSession([refLine("r1", "x", 5)]);
        act(() => result.current.dragElement("refline:7", 300, 200));
        expect(draftRefLines()[0].value).toBe(5);
      });
    });

    it("reaches the render request, so the preview shows what the panel edits", async () => {
      useApp.setState({ figurePublicationSession: session(refLineDocument("figure-ref-h", [])) });
      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(result.current.preview).not.toBeNull());
      act(() => result.current.addRefLine("x", 7));
      // ref_lines is the wire field lib/figureOverrides.ts's viewOverrides
      // maps refLines onto (2026-08-11 figure_decor slice) — without this the
      // panel would edit a field the rendered figure never shows.
      await waitFor(() =>
        expect(vi.mocked(renderFigureHitmap).mock.calls.at(-1)?.[0].overrides?.ref_lines)
          .toEqual([{ axis: "x", value: 7 }]),
      );
    });
  });

  // F2.3e: axis tick formats (xFmt/yFmt/y2Fmt) live straight on
  // document.plot.view -- the same canonical-only fields as the three slices
  // above, and unlike them they ALREADY reached the renderer, so the panel
  // was the only missing piece. Same coverage contract: setters, the
  // Apply/Cancel pin, and proof the edit reaches the render request.
  describe("canonical tick formats (F2.3e)", () => {
    const win = (id: string, document?: ReturnType<typeof createFigureDocument>): PlotWindow => ({
      id, kind: "plot", title: document?.name ?? id, datasetId: "d1",
      geometry: { x: 0, y: 0, w: 400, h: 300 }, z: 1, winState: "normal",
      view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
      ...(document ? { document } : {}),
    });
    const fmtDocument = (id: string, view: Partial<ReturnType<typeof defaultPlotView>> = {}) =>
      createFigureDocument({ id, name: "Fmt doc", datasetId: "d1", view: { ...defaultPlotView(), ...view } });
    const session = (document: ReturnType<typeof createFigureDocument>) => ({
      target: "window" as const, windowId: "w1",
      baseline: structuredClone(document), draft: structuredClone(document),
    });

    it("falls back to the live singletons in legacy (non-canonical) mode", () => {
      useApp.setState({ xFmt: { mode: "sci", digits: 1 }, yFmt: { mode: "eng", digits: 2 } });
      const { result } = renderHook(() => useFigureBuilder());
      expect(result.current.canonicalXFmt).toEqual({ mode: "sci", digits: 1 });
      expect(result.current.canonicalYFmt).toEqual({ mode: "eng", digits: 2 });
    });

    it("exposes the draft's own formats once canonical, not the live plot's", () => {
      useApp.setState({
        xFmt: { mode: "sci", digits: 1 },
        figurePublicationSession: session(fmtDocument("figure-fmt-a", { xFmt: { mode: "fixed", digits: 3 } })),
      });
      const { result } = renderHook(() => useFigureBuilder());
      expect(result.current.canonicalXFmt).toEqual({ mode: "fixed", digits: 3 });
    });

    it("writes each axis format into the draft independently", () => {
      useApp.setState({ figurePublicationSession: session(fmtDocument("figure-fmt-b")) });
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.setXFmtCanonical({ mode: "sci", digits: 3 }));
      act(() => result.current.setYFmtCanonical({ mode: "fixed", digits: 1 }));
      const view = useApp.getState().figurePublicationSession!.draft.plot.view;
      expect(view.xFmt).toEqual({ mode: "sci", digits: 3 });
      expect(view.yFmt).toEqual({ mode: "fixed", digits: 1 });
      expect(view.y2Fmt).toBeNull();
    });

    it("round-trips y2 inheritance through null, the renderer's own sentinel", () => {
      useApp.setState({ figurePublicationSession: session(fmtDocument("figure-fmt-c")) });
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.setY2FmtCanonical({ mode: "eng", digits: 2 }));
      expect(useApp.getState().figurePublicationSession!.draft.plot.view.y2Fmt).toEqual({ mode: "eng", digits: 2 });
      act(() => result.current.setY2FmtCanonical(null));
      expect(useApp.getState().figurePublicationSession!.draft.plot.view.y2Fmt).toBeNull();
    });

    it("offers date modes only when the bound data's X column is timestamps", () => {
      useApp.setState({ figurePublicationSession: session(fmtDocument("figure-fmt-d")) });
      const plain = renderHook(() => useFigureBuilder());
      expect(plain.result.current.xIsDate).toBe(false);

      useApp.setState({
        datasets: [{ id: "d1", name: "log.csv", data: { ...DATA, metadata: { time_is_datetime: true } } }],
        figurePublicationSession: session(fmtDocument("figure-fmt-d2")),
      });
      const dated = renderHook(() => useFigureBuilder());
      expect(dated.result.current.xIsDate).toBe(true);
    });

    it("Apply commits format edits into the window document and the legacy facade", async () => {
      const document = fmtDocument("figure-fmt-e");
      useApp.setState({
        ...defaultPlotView(),
        figurePublicationSession: session(document),
        plotWindows: [win("w1", structuredClone(document))],
        focusedWindowId: "w1",
      });
      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(result.current.hitmap).not.toBeNull());
      act(() => result.current.setYFmtCanonical({ mode: "sci", digits: 3 }));
      act(() => result.current.apply());

      const state = useApp.getState();
      expect(state.figurePublicationSession).toBeNull();
      expect(state.plotWindows[0].document?.plot.view.yFmt).toEqual({ mode: "sci", digits: 3 });
      // The same field Inspector/TickFormat reads on the Stage.
      expect(state.yFmt).toEqual({ mode: "sci", digits: 3 });
    });

    it("Cancel makes no persistent mutation", () => {
      const document = fmtDocument("figure-fmt-f");
      useApp.setState({
        figurePublicationSession: session(document),
        plotWindows: [win("w1", structuredClone(document))],
        focusedWindowId: "w1",
      });
      const before = structuredClone(useApp.getState().plotWindows);
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.setXFmtCanonical({ mode: "eng", digits: 4 }));
      act(() => result.current.cancel());
      expect(useApp.getState().plotWindows).toEqual(before);
    });

    it("reaches the render request, so the preview shows the notation the panel picks", async () => {
      useApp.setState({ figurePublicationSession: session(fmtDocument("figure-fmt-g")) });
      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(result.current.preview).not.toBeNull());
      act(() => result.current.setYFmtCanonical({ mode: "sci", digits: 3 }));
      await waitFor(() =>
        expect(vi.mocked(renderFigureHitmap).mock.calls.at(-1)?.[0].y_fmt)
          .toEqual({ mode: "sci", digits: 3 }),
      );
    });

    it("omits the format from the request while an axis is auto (MAIN #24's lean-request rule)", async () => {
      useApp.setState({ figurePublicationSession: session(fmtDocument("figure-fmt-h")) });
      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(result.current.preview).not.toBeNull());
      expect(vi.mocked(renderFigureHitmap).mock.calls.at(-1)?.[0].y_fmt).toBeUndefined();
    });
  });

  // F2.3f: error-column bindings live on document.bindings.errors -- NOT the
  // PlotView -- so this is the one canonical-only slice that does not route
  // through setCanonicalView. Same coverage contract as F2.3d/e regardless:
  // setters, Apply-commits/Cancel-is-mutation-free, and a wire-reaches-render
  // proof. The extra case: the read-only Series summary (F2.3b) must reflect
  // a binding added through THIS panel rather than reading stale data.
  describe("canonical error-column bindings (F2.3f)", () => {
    const win = (id: string, document?: ReturnType<typeof createFigureDocument>): PlotWindow => ({
      id, kind: "plot", title: document?.name ?? id, datasetId: "d1",
      geometry: { x: 0, y: 0, w: 400, h: 300 }, z: 1, winState: "normal",
      view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
      ...(document ? { document } : {}),
    });
    const eb = (channel: number, target: number, axis: "x" | "y", side: "both" | "+" | "-") =>
      ({ channel, target, axis, side });
    const errorDocument = (
      id: string,
      errors: ReturnType<typeof eb>[],
      view: Partial<ReturnType<typeof defaultPlotView>> = {},
    ) => createFigureDocument({ id, name: "Err doc", datasetId: "d1", view: { ...defaultPlotView(), ...view }, errors });
    const session = (document: ReturnType<typeof createFigureDocument>) => ({
      target: "window" as const, windowId: "w1",
      baseline: structuredClone(document), draft: structuredClone(document),
    });

    it("computes an empty error-binding list in legacy (non-canonical) mode", () => {
      const { result } = renderHook(() => useFigureBuilder());
      expect(result.current.errorBindings).toEqual([]);
    });

    it("exposes the draft's error bindings once canonical", () => {
      useApp.setState({ figurePublicationSession: session(errorDocument("figure-err-a", [eb(1, 0, "y", "both")])) });
      const { result } = renderHook(() => useFigureBuilder());
      expect(result.current.errorBindings).toEqual([eb(1, 0, "y", "both")]);
    });

    it("patchErrorBinding patches the binding at the given index only", () => {
      useApp.setState({
        figurePublicationSession: session(
          errorDocument("figure-err-b", [eb(1, 0, "y", "both"), eb(0, -1, "x", "both")]),
        ),
      });
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.patchErrorBinding(0, { side: "+" }));
      expect(useApp.getState().figurePublicationSession!.draft.bindings.errors).toEqual([
        eb(1, 0, "y", "+"),
        eb(0, -1, "x", "both"),
      ]);
    });

    it("addErrorBinding appends a new binding", () => {
      useApp.setState({ figurePublicationSession: session(errorDocument("figure-err-c", [])) });
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.addErrorBinding(1, 0, "y", "both"));
      expect(useApp.getState().figurePublicationSession!.draft.bindings.errors).toEqual([eb(1, 0, "y", "both")]);
    });

    it("removeErrorBinding drops the binding at the given index only", () => {
      useApp.setState({
        figurePublicationSession: session(
          errorDocument("figure-err-d", [eb(1, 0, "y", "both"), eb(0, -1, "x", "both")]),
        ),
      });
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.removeErrorBinding(0));
      expect(useApp.getState().figurePublicationSession!.draft.bindings.errors).toEqual([eb(0, -1, "x", "both")]);
    });

    it("detectErrorBindings replaces the draft's bindings with the pure name-inference result", () => {
      useApp.setState({
        datasets: [{ id: "d1", name: "scan.dat", data: { ...DATA, labels: ["R", "dR"] } }],
        figurePublicationSession: session(errorDocument("figure-err-e", [])),
      });
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.detectErrorBindings());
      expect(useApp.getState().figurePublicationSession!.draft.bindings.errors).toEqual([eb(1, 0, "y", "both")]);
    });

    it("the read-only Series summary (F2.3b) reflects a binding added here, not stale data", () => {
      useApp.setState({ figurePublicationSession: session(errorDocument("figure-err-i", [], { yKeys: [0] })) });
      const { result } = renderHook(() => useFigureBuilder());
      expect(result.current.seriesErrors).toEqual([]);
      act(() => result.current.addErrorBinding(1, 0, "y", "both"));
      expect(result.current.seriesErrors).toEqual([eb(1, 0, "y", "both")]);
    });

    it("Apply commits into the window document and mirrors symmetric-Y bindings into errKeys", async () => {
      const document = errorDocument("figure-err-f", [eb(1, 0, "y", "both")]);
      useApp.setState({
        // Unlike the other F2.3 fields (plain PlotView members), a symmetric-Y
        // binding round-trips through the LIVE errKeys singleton -- seed it
        // from the document so the focused window's live facade already
        // agrees with the session baseline before any edit (see
        // figureDocument.ts's updateFigureDocumentFromPlotView).
        ...figureDocumentToPlotView(document),
        figurePublicationSession: session(document),
        plotWindows: [win("w1", structuredClone(document))],
        focusedWindowId: "w1",
      });
      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(result.current.hitmap).not.toBeNull());
      act(() => result.current.addErrorBinding(0, -1, "x", "both"));
      act(() => result.current.apply());

      const state = useApp.getState();
      expect(state.figurePublicationSession).toBeNull();
      expect(state.plotWindows[0].document?.bindings.errors).toEqual([
        eb(1, 0, "y", "both"),
        eb(0, -1, "x", "both"),
      ]);
      // errKeysFromBindings only projects symmetric Y bindings -- the x
      // binding above has no place in the legacy Record<number,number> shape.
      expect(state.errKeys).toEqual({ 0: 1 });
    });

    it("Cancel makes no persistent mutation", () => {
      const document = errorDocument("figure-err-g", [eb(1, 0, "y", "both")]);
      useApp.setState({
        figurePublicationSession: session(document),
        plotWindows: [win("w1", structuredClone(document))],
        focusedWindowId: "w1",
      });
      const before = structuredClone(useApp.getState().plotWindows);
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.addErrorBinding(0, -1, "x", "both"));
      act(() => result.current.cancel());
      const state = useApp.getState();
      expect(state.figurePublicationSession).toBeNull();
      expect(state.plotWindows).toEqual(before);
    });

    it("reaches the render request, so the preview shows what the panel edits", async () => {
      useApp.setState({
        figurePublicationSession: session(errorDocument("figure-err-h", [], { yKeys: [0] })),
      });
      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(result.current.preview).not.toBeNull());
      act(() => result.current.addErrorBinding(1, 0, "y", "both"));
      // error_spans is the wire field buildFigureSpecForView derives from
      // document.bindings.errors via exportErrorSpans (MAIN #36) -- without
      // this the panel would edit a field the rendered figure never shows.
      await waitFor(() =>
        expect(vi.mocked(renderFigureHitmap).mock.calls.at(-1)?.[0].error_spans).toEqual([
          { y: { plus: [9, 8, 7], minus: [9, 8, 7] } },
        ]),
      );
    });
  });

  // F2.3g: channel membership (X axis, and each other channel's Y/Y2/not-
  // plotted state) lives on document.bindings too -- same "not the PlotView"
  // shape as F2.3f's error bindings, so it does not route through
  // setCanonicalView either. Same coverage contract as F2.3d/e/f: setters,
  // Apply-commits/Cancel-is-mutation-free, and a wire-reaches-render proof.
  // The extra case: a guard-rejected toggle must not even reach the store
  // (canonicalChannels.test.ts covers the guard LOGIC; this proves the
  // wrapper actually skips the patch instead of writing a no-op history entry).
  describe("canonical channel membership (F2.3g)", () => {
    const win = (id: string, document?: ReturnType<typeof createFigureDocument>): PlotWindow => ({
      id, kind: "plot", title: document?.name ?? id, datasetId: "d1",
      geometry: { x: 0, y: 0, w: 400, h: 300 }, z: 1, winState: "normal",
      view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
      ...(document ? { document } : {}),
    });
    const channelDocument = (
      id: string,
      view: Partial<ReturnType<typeof defaultPlotView>> = {},
    ) => createFigureDocument({ id, name: "Ch doc", datasetId: "d1", view: { ...defaultPlotView(), ...view } });
    const session = (document: ReturnType<typeof createFigureDocument>) => ({
      target: "window" as const, windowId: "w1",
      baseline: structuredClone(document), draft: structuredClone(document),
    });

    it("computes null channel membership in legacy (non-canonical) mode", () => {
      const { result } = renderHook(() => useFigureBuilder());
      expect(result.current.channelXKey).toBeNull();
      expect(result.current.channelYKeys).toBeNull();
      expect(result.current.channelY2Keys).toBeNull();
    });

    it("exposes the draft's channel bindings once canonical", () => {
      useApp.setState({
        figurePublicationSession: session(channelDocument("figure-ch-a", { xKey: 1, yKeys: [0], y2Keys: null })),
      });
      const { result } = renderHook(() => useFigureBuilder());
      expect(result.current.channelXKey).toBe(1);
      expect(result.current.channelYKeys).toEqual([0]);
      expect(result.current.channelY2Keys).toBeNull();
    });

    it("setChannelXKey patches the draft's xKey only", () => {
      useApp.setState({ figurePublicationSession: session(channelDocument("figure-ch-b", { yKeys: [0, 1] })) });
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.setChannelXKey(1));
      const draft = useApp.getState().figurePublicationSession!.draft;
      expect(draft.bindings.xKey).toBe(1);
      expect(draft.bindings.yKeys).toEqual([0, 1]);
    });

    it("toggleChannelY adds an unselected channel to the draft's yKeys", () => {
      useApp.setState({ figurePublicationSession: session(channelDocument("figure-ch-c", { yKeys: [0] })) });
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.toggleChannelY(1));
      expect(useApp.getState().figurePublicationSession!.draft.bindings.yKeys).toEqual([0, 1]);
    });

    it("toggleChannelY removes a selected channel from the draft's yKeys", () => {
      useApp.setState({ figurePublicationSession: session(channelDocument("figure-ch-d", { yKeys: [0, 1] })) });
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.toggleChannelY(0));
      expect(useApp.getState().figurePublicationSession!.draft.bindings.yKeys).toEqual([1]);
    });

    it("toggleChannelY is a no-op -- no store write at all -- when it would leave nothing plotted", () => {
      useApp.setState({ figurePublicationSession: session(channelDocument("figure-ch-e", { yKeys: [0] })) });
      const before = useApp.getState().figurePublicationSession;
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.toggleChannelY(0));
      // The SAME session object (not just an equal one) -- the guard means
      // the wrapper never called patchFigurePublicationDraft at all.
      expect(useApp.getState().figurePublicationSession).toBe(before);
    });

    it("toggleChannelY2 promotes an already-plotted channel onto y2Keys", () => {
      useApp.setState({ figurePublicationSession: session(channelDocument("figure-ch-f", { yKeys: [0, 1] })) });
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.toggleChannelY2(0));
      expect(useApp.getState().figurePublicationSession!.draft.bindings.y2Keys).toEqual([0]);
    });

    it("Apply commits channel bindings into the window document and mirrors them into the legacy facade", async () => {
      const document = channelDocument("figure-ch-g", { yKeys: [0] });
      useApp.setState({
        // Seed the live facade to already agree with the session baseline
        // (figureLifecycle.ts's liveWindowDocument rebuilds the focused
        // window's "live" document from the top-level xKey/yKeys/y2Keys
        // singletons, not from window.document.bindings) -- same seed
        // F2.3f's error-binding Apply test needs, for the same reason.
        ...figureDocumentToPlotView(document),
        figurePublicationSession: session(document),
        plotWindows: [win("w1", structuredClone(document))],
        focusedWindowId: "w1",
      });
      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(result.current.hitmap).not.toBeNull());
      act(() => result.current.toggleChannelY(1));
      act(() => result.current.apply());

      const state = useApp.getState();
      expect(state.figurePublicationSession).toBeNull();
      expect(state.plotWindows[0].document?.bindings.yKeys).toEqual([0, 1]);
      // hydrateView spreads the applied view onto the legacy top-level facade
      // (the same singleton ChannelsCard reads/writes on the Stage).
      expect(state.yKeys).toEqual([0, 1]);
    });

    it("Cancel makes no persistent mutation", () => {
      const document = channelDocument("figure-ch-h", { yKeys: [0] });
      useApp.setState({
        figurePublicationSession: session(document),
        plotWindows: [win("w1", structuredClone(document))],
        focusedWindowId: "w1",
      });
      const before = structuredClone(useApp.getState().plotWindows);
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.toggleChannelY(1));
      act(() => result.current.cancel());
      const state = useApp.getState();
      expect(state.figurePublicationSession).toBeNull();
      expect(state.plotWindows).toEqual(before);
    });

    it("reaches the render request, so the preview shows the channel the panel selects", async () => {
      useApp.setState({ figurePublicationSession: session(channelDocument("figure-ch-i", { yKeys: [0] })) });
      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(result.current.preview).not.toBeNull());
      act(() => result.current.toggleChannelY(1));
      await waitFor(() =>
        expect(vi.mocked(renderFigureHitmap).mock.calls.at(-1)?.[0].y_keys).toEqual([0, 1]),
      );
    });

    it("reaches the render request for an X-axis reassignment too", async () => {
      useApp.setState({ figurePublicationSession: session(channelDocument("figure-ch-j", { yKeys: [0] })) });
      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(result.current.preview).not.toBeNull());
      act(() => result.current.setChannelXKey(1));
      await waitFor(() =>
        expect(vi.mocked(renderFigureHitmap).mock.calls.at(-1)?.[0].x_key).toBe(1),
      );
    });
  });

  // F2.3h: the group-by binding lives on document.bindings.groupKey -- NOT
  // the PlotView -- same reasoning and coverage contract as F2.3f directly
  // above: setters, Apply-commits/Cancel-is-mutation-free, and a
  // wire-reaches-render proof (group_col). The grouped+y2 rejection is
  // figureSpec.ts's own concern (pinned there, figureSpec.test.ts); this
  // suite only proves the panel's setter reaches the SAME document field
  // that check reads.
  describe("canonical group-by binding (F2.3h)", () => {
    const win = (id: string, document?: ReturnType<typeof createFigureDocument>): PlotWindow => ({
      id, kind: "plot", title: document?.name ?? id, datasetId: "d1",
      geometry: { x: 0, y: 0, w: 400, h: 300 }, z: 1, winState: "normal",
      view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
      ...(document ? { document } : {}),
    });
    const groupDocument = (
      id: string,
      groupKey: number | null,
      view: Partial<ReturnType<typeof defaultPlotView>> = {},
    ) => createFigureDocument({ id, name: "Group doc", datasetId: "d1", view: { ...defaultPlotView(), ...view }, groupKey });
    const session = (document: ReturnType<typeof createFigureDocument>) => ({
      target: "window" as const, windowId: "w1",
      baseline: structuredClone(document), draft: structuredClone(document),
    });

    it("computes null in legacy (non-canonical) mode", () => {
      const { result } = renderHook(() => useFigureBuilder());
      expect(result.current.groupKey).toBeNull();
    });

    it("exposes the draft's group-by binding once canonical", () => {
      useApp.setState({ figurePublicationSession: session(groupDocument("figure-grp-a", 1)) });
      const { result } = renderHook(() => useFigureBuilder());
      expect(result.current.groupKey).toBe(1);
    });

    it("setGroupKey writes the chosen channel into the draft", () => {
      useApp.setState({ figurePublicationSession: session(groupDocument("figure-grp-b", null)) });
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.setGroupKey(0));
      expect(useApp.getState().figurePublicationSession!.draft.bindings.groupKey).toBe(0);
    });

    it("setGroupKey(null) clears an existing binding", () => {
      useApp.setState({ figurePublicationSession: session(groupDocument("figure-grp-c", 1)) });
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.setGroupKey(null));
      expect(useApp.getState().figurePublicationSession!.draft.bindings.groupKey).toBeNull();
    });

    it("Apply commits into the window document", async () => {
      const document = groupDocument("figure-grp-d", null);
      useApp.setState({
        // Same requirement as every other F2.3 Apply test: applyFigurePublicationEdit
        // resolves the focused window's "live" document from the store's
        // top-level ambient PlotView fields, which must mirror the
        // baseline's view (defaultPlotView() here) or Apply rejects as
        // drifted -- groupKey itself is NOT a live singleton (it carries
        // forward from the window's own stored document), so this is about
        // matching the surrounding view, not the field under test.
        ...defaultPlotView(),
        figurePublicationSession: session(document),
        plotWindows: [win("w1", structuredClone(document))],
        focusedWindowId: "w1",
      });
      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(result.current.hitmap).not.toBeNull());
      act(() => result.current.setGroupKey(1));
      act(() => result.current.apply());

      const state = useApp.getState();
      expect(state.figurePublicationSession).toBeNull();
      expect(state.plotWindows[0].document?.bindings.groupKey).toBe(1);
    });

    it("Cancel makes no persistent mutation", () => {
      const document = groupDocument("figure-grp-e", null);
      useApp.setState({
        figurePublicationSession: session(document),
        plotWindows: [win("w1", structuredClone(document))],
        focusedWindowId: "w1",
      });
      const before = structuredClone(useApp.getState().plotWindows);
      const { result } = renderHook(() => useFigureBuilder());
      act(() => result.current.setGroupKey(1));
      act(() => result.current.cancel());
      const state = useApp.getState();
      expect(state.figurePublicationSession).toBeNull();
      expect(state.plotWindows).toEqual(before);
    });

    it("reaches the render request as group_col, so the preview shows what the panel edits", async () => {
      useApp.setState({
        figurePublicationSession: session(groupDocument("figure-grp-f", null, { yKeys: [0, 1] })),
      });
      const { result } = renderHook(() => useFigureBuilder());
      await waitFor(() => expect(result.current.preview).not.toBeNull());
      act(() => result.current.setGroupKey(0));
      await waitFor(() =>
        expect(vi.mocked(renderFigureHitmap).mock.calls.at(-1)?.[0].group_col).toBe(0),
      );
    });
  });

  // F2.4b gap analysis: PreviewOverlay's drag (legend/annotation) and
  // double-click text (title/xlabel/ylabel) gestures already branched on
  // `canonical` from the initial canonical session (a6c809c), and commit
  // 4e74bc4 (F2.3a) already routed drag through the SAME effective-overrides
  // read/write bridge property panels use -- so legend drag, annotation
  // drag, and title double-click already wrote into the draft correctly.
  // Two real gaps, both in COVERAGE, not implementation: xlabel/ylabel
  // double-click had zero test coverage anywhere in this file, and no test
  // proved the full gesture -> Apply -> window document, gesture -> Cancel
  // -> no-mutation round trip this slice's contract requires (only F2.3b's
  // series properties had that pattern). These tests close both. The
  // legacy-mode block pins current (unchanged) behavior first, per the
  // "characterize before touching a shared handler" rule -- even though the
  // investigation found no shared-handler change was needed.
  describe("direct manipulation parity (F2.4b)", () => {
    const win = (id: string, document?: ReturnType<typeof createFigureDocument>): PlotWindow => ({
      id, kind: "plot", title: document?.name ?? id, datasetId: "d1",
      geometry: { x: 0, y: 0, w: 400, h: 300 }, z: 1, winState: "normal",
      view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
      ...(document ? { document } : {}),
    });
    const documentWithAnnotation = (id: string) => createFigureDocument({
      id, name: "Annotated", datasetId: "d1",
      view: { ...defaultPlotView(), annotations: [{ id: "a1", x: 1, y: 2, text: "Hello" }] },
    });

    describe("legacy (non-canonical) characterization", () => {
      it("editElementText writes straight into the local title/label fields, no session involved", async () => {
        const { result } = renderHook(() => useFigureBuilder());
        await waitFor(() => expect(result.current.preview).not.toBeNull());
        act(() => {
          result.current.editElementText("title", "Local title");
          result.current.editElementText("xlabel", "Local x");
          result.current.editElementText("ylabel", "Local y");
        });
        expect(result.current.title).toBe("Local title");
        expect(result.current.xLabel).toBe("Local x");
        expect(result.current.yLabel).toBe("Local y");
        expect(useApp.getState().figurePublicationSession).toBeNull();
      });

      it("dragElement writes straight into the local overrides object, no session involved", async () => {
        const { result } = renderHook(() => useFigureBuilder());
        await waitFor(() => expect(result.current.preview).not.toBeNull());
        // dragElement no-ops until the hitmap it maps pixels against has
        // landed on `result.current` -- "the mock was called" only proves the
        // debounced fetch STARTED, not that its resolved hitmap has reached
        // this render (see the F2.4b Apply test below for the flake this
        // gap caused). This file's established fix is the second, stronger
        // wait already used by the axis-breaks/annotations tests above.
        await waitFor(() => expect(result.current.hitmap).not.toBeNull());
        act(() => result.current.setOverrides({
          ...result.current.overrides,
          annotations: [{ x: 1, y: 2, text: "Hello" }],
        }));
        // One act() per drag: legacy mode's setOverrides is a plain (non-
        // functional) useState setter reading the closed-over `overrides`,
        // so two calls batched into one synchronous act() would have the
        // second overwrite the first with a stale base -- an artifact of
        // this test harness batching what real, separate pointer gestures
        // never do, not a product bug (canonical mode's patchCanonical goes
        // through Zustand's functional set() and does not share this trait).
        act(() => result.current.dragElement("legend", 300, 200));
        act(() => result.current.dragElement("ann:0", 350, 150));
        expect(result.current.overrides.legend).toMatchObject({ loc: "custom" });
        expect(result.current.overrides.annotations?.[0]).toMatchObject({ text: "Hello" });
        expect(useApp.getState().figurePublicationSession).toBeNull();
      });

      // TEST_DETERMINISM_PLAN task 1: the test above (and its F2.4b Apply/
      // Cancel siblings) synchronised on `waitFor(result.current.hitmap)`
      // because the WEAK wait -- `waitFor(renderFigureHitmap toHaveBeenCalled)`
      // -- only proves the debounced fetch STARTED, not that its resolved
      // hitmap reached `result.current`. That fix was verified by 0/90
      // repetitions against a 1/30 baseline, which the rule of three shows is
      // statistically indistinguishable from "unchanged" (0/90 bounds the
      // post-fix rate at 3/90 = 3.3%, identical to the baseline). This test
      // replaces that probabilistic evidence: it takes manual control of
      // WHEN the hitmap promise resolves, so the drag is dispatched during
      // the race window on every single run, deterministically, rather than
      // hoping real scheduling loses the race the way the repro method did.
      //
      // What "correct" means here (useFigureBuilder.ts:494's
      // `if (!hitmap) return;`): a drag dispatched before the hitmap lands
      // must be SAFELY DROPPED, not deferred or queued. The hitmap IS the
      // pixel<->data/figure-fraction calibration the drag needs (see
      // pxToFigureFraction/pxToData) -- there is no meaningful position to
      // apply before it exists, and no production change (a pending-gesture
      // queue) is warranted for a window a real user cannot even reach: the
      // draggable elements are themselves painted from the hitmap, so
      // nothing is on screen to grab until it has landed. The guard is
      // correct as written; this test pins that and proves it holds even
      // when the race is forced instead of merely possible.
      it("forces the item-22 race: a drag dispatched before the hitmap lands is safely dropped, and the same gesture succeeds once it resolves", async () => {
        // Take manual control of resolution instead of the module-level
        // auto-resolving mock, so the hitmap is GUARANTEED still null when
        // the drag below fires -- not merely likely, as under real scheduling.
        let resolveHitmap!: (value: FigureHitmap) => void;
        const deferred = new Promise<FigureHitmap>((resolve) => {
          resolveHitmap = resolve;
        });
        vi.mocked(renderFigureHitmap).mockReturnValueOnce(deferred);

        const { result } = renderHook(() => useFigureBuilder());

        // The weak signal item 22's original (buggy) wait relied on: the
        // debounced fetch has started. `deferred` is still unresolved, so
        // the hitmap is provably null here -- this is the forced race window.
        await waitFor(() => expect(renderFigureHitmap).toHaveBeenCalledTimes(1));
        expect(result.current.hitmap).toBeNull();

        act(() => result.current.dragElement("legend", 300, 200));
        expect(result.current.overrides.legend).toBeUndefined();

        // Let the preview land -- deliberately a BARE resolve, not wrapped in
        // an (async) act(): resolving the promise only schedules its `.then()`
        // as a microtask, it does not force React to flush it. The very next
        // statement runs in the same synchronous turn, so without an explicit
        // yield/wait, `result.current.hitmap` is not yet guaranteed to see it
        // -- this is what makes the `waitFor` below load-bearing rather than
        // decorative (see the revert proof in the task report).
        resolveHitmap({
          image: "cGln",
          width: 600,
          height: 400,
          elements: [{ id: "title", x0: 1, y0: 1, x1: 2, y1: 2 }],
          axes: { x0: 0, y0: 0, x1: 600, y1: 400, xlim: [0, 1], ylim: [0, 1], xlog: false, ylog: false },
        });
        await waitFor(() => expect(result.current.hitmap).not.toBeNull());

        // Confirm the SAME gesture succeeds once the hitmap it depends on
        // has actually reached `result.current`.
        act(() => result.current.dragElement("legend", 300, 200));
        expect(result.current.overrides.legend).toMatchObject({ loc: "custom" });
      });
    });

    // Previously untested in canonical mode (only "title" had coverage).
    describe("canonical double-click text", () => {
      it('editElementText("xlabel") writes document.plot.view.xAxisLabel', async () => {
        const document = createFigureDocument({ id: "figure-xlabel", name: "Doc", datasetId: "d1", view: defaultPlotView() });
        useApp.setState({
          figurePublicationSession: { target: "window", windowId: "w1", baseline: structuredClone(document), draft: structuredClone(document) },
        });
        const { result } = renderHook(() => useFigureBuilder());
        await waitFor(() => expect(result.current.preview).not.toBeNull());
        act(() => result.current.editElementText("xlabel", "New X"));
        expect(useApp.getState().figurePublicationSession!.draft.plot.view.xAxisLabel).toBe("New X");
      });

      it('editElementText("ylabel") writes document.plot.view.yAxisLabel', async () => {
        const document = createFigureDocument({ id: "figure-ylabel", name: "Doc", datasetId: "d1", view: defaultPlotView() });
        useApp.setState({
          figurePublicationSession: { target: "window", windowId: "w1", baseline: structuredClone(document), draft: structuredClone(document) },
        });
        const { result } = renderHook(() => useFigureBuilder());
        await waitFor(() => expect(result.current.preview).not.toBeNull());
        act(() => result.current.editElementText("ylabel", "New Y"));
        expect(useApp.getState().figurePublicationSession!.draft.plot.view.yAxisLabel).toBe("New Y");
      });
    });

    describe("gesture -> Apply -> window document reflects it; Cancel -> no mutation", () => {
      it("Apply commits legend drag, annotation drag, and title/xlabel/ylabel edits into the window document and legacy facade", async () => {
        const document = documentWithAnnotation("figure-drag-apply");
        useApp.setState({
          // liveWindowDocument folds the top-level ambient PlotView fields
          // into the focused window's document (F2.3b's Apply test needs the
          // same mirroring) -- keep the singleton annotations in sync with
          // the baseline so Apply doesn't see the focused window as drifted.
          ...defaultPlotView(),
          annotations: document.plot.view.annotations,
          figurePublicationSession: { target: "window", windowId: "w1", baseline: structuredClone(document), draft: structuredClone(document) },
          plotWindows: [win("w1", structuredClone(document))],
          focusedWindowId: "w1",
        });
        const { result } = renderHook(() => useFigureBuilder());
        await waitFor(() => expect(result.current.preview).not.toBeNull());
        // KNOWN FLAKE, root-caused: "toHaveBeenCalled" only proves the
        // debounced fetch started, not that its resolved hitmap has reached
        // this render -- dragElement no-ops on a still-null hitmap. Under
        // normal load the state update lands before this line runs; under
        // full-suite parallel worker contention it sometimes doesn't, and
        // the legend drag below silently no-ops, leaving
        // `appliedDoc.publication.overrides.legend` undefined (booked
        // 2026-08-07, reproduced directly with --no-file-parallelism,
        // 1/21 local runs). This second wait is the same fix the
        // axis-breaks/annotations tests above already use.
        await waitFor(() => expect(result.current.hitmap).not.toBeNull());
        // One act() per gesture, mirroring separate real pointer/keyboard
        // events (and this file's own legacy-mode pattern above) rather than
        // batching five state-changing calls into one synchronous callback.
        act(() => result.current.dragElement("legend", 300, 200));
        act(() => result.current.dragElement("ann:0", 350, 150));
        act(() => result.current.editElementText("title", "Applied title"));
        act(() => result.current.editElementText("xlabel", "Applied X"));
        act(() => result.current.editElementText("ylabel", "Applied Y"));
        act(() => {
          result.current.apply();
        });

        const state = useApp.getState();
        expect(state.figurePublicationSession).toBeNull();
        const appliedDoc = state.plotWindows[0].document!;
        expect(appliedDoc.plot.view).toMatchObject({
          plotTitle: "Applied title",
          xAxisLabel: "Applied X",
          yAxisLabel: "Applied Y",
        });
        expect(appliedDoc.publication?.overrides?.legend).toMatchObject({ loc: "custom" });
        expect(appliedDoc.publication?.overrides?.annotations?.[0]).toMatchObject({ text: "Hello" });
        // hydrateView spreads the applied view onto the legacy top-level
        // facade (same pattern F2.3b's Apply test pins for series fields):
        // title/labels live on plot.view, so they reach the facade exactly
        // like a Stage edit always has.
        expect(state.plotTitle).toBe("Applied title");
        expect(state.xAxisLabel).toBe("Applied X");
        expect(state.yAxisLabel).toBe("Applied Y");
        // The legend/annotation drag position is a PUBLICATION-only delta
        // (FigurePublicationState: "exact publication-only settings that
        // PlotView cannot represent" -- see canonicalOverrides.ts's module
        // doc), by the same design F2.3a's property-panel edits already
        // use -- it does NOT flow into plot.view or the Stage facade. This
        // is unchanged, deliberate architecture, not a gap: matplotlib's
        // figure-fraction legend anchor and the Stage canvas's own
        // plot-fraction legendXY are different coordinate systems, and nothing
        // in this codebase converts between them.
        expect(state.legendXY).toBeNull();
      });

      it("Cancel after a legend/annotation drag and a text edit makes no persistent mutation", async () => {
        const document = documentWithAnnotation("figure-drag-cancel");
        useApp.setState({
          figurePublicationSession: { target: "window", windowId: "w1", baseline: structuredClone(document), draft: structuredClone(document) },
          plotWindows: [win("w1", structuredClone(document))],
          focusedWindowId: "w1",
        });
        const before = structuredClone(useApp.getState().plotWindows);
        const { result } = renderHook(() => useFigureBuilder());
        await waitFor(() => expect(result.current.preview).not.toBeNull());
        // Same hitmap-readiness wait as the Apply test above -- this test's
        // own assertions don't depend on the drag having registered (Cancel
        // discards the draft either way), but keeping it consistent means a
        // future assertion here won't inherit the same race silently.
        await waitFor(() => expect(result.current.hitmap).not.toBeNull());
        act(() => result.current.dragElement("legend", 300, 200));
        act(() => result.current.dragElement("ann:0", 350, 150));
        act(() => result.current.editElementText("title", "Should not persist"));
        act(() => {
          result.current.cancel();
        });
        const state = useApp.getState();
        expect(state.figurePublicationSession).toBeNull();
        expect(state.plotWindows).toEqual(before);
      });
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
      await waitFor(() => expect(result.current.preview).not.toBeNull());

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
      await waitFor(() => expect(result.current.preview).not.toBeNull());

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
