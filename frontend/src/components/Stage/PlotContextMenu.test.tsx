import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import PlotContextMenu from "./PlotContextMenu";
import type { PlotPayload } from "../../lib/plotdata";
import { askAnnotationText } from "../../store/annotationTextDialog";
import { useApp } from "../../store/useApp";
import type { PlotStageActions } from "./usePlotStageActions";

vi.mock("../../store/annotationTextDialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../store/annotationTextDialog")>()),
  askAnnotationText: vi.fn(),
}));

const mockAskAnnotationText = vi.mocked(askAnnotationText);

// A minimal fake uPlot: the plot rect is [100,100]→[500,400] and posToVal /
// valToPos are identity, so a click at client (300,250) probes localX=200
// (x-index 2 of the column below) and localY=150.
function fakePlot(): uPlot {
  return {
    over: {
      getBoundingClientRect: () => ({ left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300 }),
    },
    data: [
      [0, 100, 200, 300, 400],
      [10, 20, 150, 40, 50], // series 0 → y=150 at idx 2 (nearest to the cursor)
      [10, 20, 300, 40, 50], // series 1 → y=300 at idx 2 (far)
    ],
    series: [{}, { scale: "y" }, { scale: "y" }],
    scales: { x: { min: 0, max: 400 }, y: { min: 0, max: 300 } },
    posToVal: (px: number) => px,
    valToPos: (v: number) => v,
  } as unknown as uPlot;
}

// B2: same fake plot, but posToVal carries a MUTABLE shift so a test can
// simulate the live plot re-ranging (store/liveWindowDocument.ts) WHILE the
// menu sits open — i.e. after the initial render/hit-test but before the
// "Add text here…" item is clicked. `shift` starts at 0, so the conversion
// at open time is identical to fakePlot()'s (data (200, 150)).
function fakePlotWithMutableScale(): { plot: uPlot; scale: { shift: number } } {
  const scale = { shift: 0 };
  const plot = {
    over: {
      getBoundingClientRect: () => ({ left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300 }),
    },
    data: [
      [0, 100, 200, 300, 400],
      [10, 20, 150, 40, 50],
      [10, 20, 300, 40, 50],
    ],
    series: [{}, { scale: "y" }, { scale: "y" }],
    scales: { x: { min: 0, max: 400 }, y: { min: 0, max: 300 } },
    posToVal: (px: number) => px + scale.shift,
    valToPos: (v: number) => v,
  } as unknown as uPlot;
  return { plot, scale };
}

const payload = {
  series: [
    { label: "A", unit: "" },
    { label: "B", unit: "" },
  ],
} as unknown as PlotPayload;

const actions: PlotStageActions = {
  resetView: vi.fn(),
  smartScale: vi.fn(),
  savePng: vi.fn(),
  copyData: vi.fn(),
  copyFigure: vi.fn(),
  snapshot: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAskAnnotationText.mockResolvedValue(null);
  useApp.setState({
    seriesStyles: {},
    seriesLabels: {},
    hiddenChannels: [],
    y2Keys: null,
    showGrid: true,
    showLegend: true,
    legendPos: "ne",
    xScale: "linear",
    yScale: "linear",
    annotations: [],
    selectedAnnotationId: null,
    history: [],
    future: [],
    plotTool: "pointer",
  });
});

function open(onClose = vi.fn()) {
  render(
    <PlotContextMenu
      x={300}
      y={250}
      plotRef={{ current: fakePlot() }}
      payload={payload}
      plotted={[0, 1]}
      hidden={[false, false]}
      actions={actions}
      onClose={onClose}
    />,
  );
  return onClose;
}

describe("PlotContextMenu", () => {
  it("opens with the hit-tested series header + colour swatches", () => {
    open();
    // The nearest curve at the cursor is display-series 0 → label "A".
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByTitle("Series 1")).toBeInTheDocument();
    // Axis + plot sections are always present.
    expect(screen.getByText("X axis")).toBeInTheDocument();
    expect(screen.getByText("Reset zoom (autoscale)")).toBeInTheDocument();
  });

  it("a colour swatch dispatches setSeriesStyle for the hit-tested channel", () => {
    const onClose = open();
    fireEvent.click(screen.getByTitle("Series 3"));
    expect(useApp.getState().seriesStyles[0]?.color).toBe("--series-3");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("a plot entry dispatches its existing store action", () => {
    open();
    // showGrid starts true → the entry reads "Hide grid".
    fireEvent.click(screen.getByText("Hide grid"));
    expect(useApp.getState().showGrid).toBe(false);
  });

  it("opens a submenu flyout on hover and dispatches a leaf action", () => {
    open();
    fireEvent.mouseEnter(screen.getByText("Width").closest(".qzk-ctx-subwrap")!);
    fireEvent.click(screen.getByText("2 px"));
    expect(useApp.getState().seriesStyles[0]?.width).toBe(2);
  });

  it("GUI_INTERACTION #3 sub-item 4: 'Move later (draw over)' reorders the hit-tested series", () => {
    // plotted=[0,1]; the hit-tested series is channel 0 (index 0) — moving it
    // later swaps it with channel 1.
    open();
    fireEvent.click(screen.getByText("Move later (draw over)"));
    expect(useApp.getState().seriesOrder).toEqual([1, 0]);
  });

  it("'Move earlier (draw under)' is disabled for the first channel in draw order", () => {
    open();
    expect(screen.getByRole("menuitem", { name: "Move earlier (draw under)" })).toBeDisabled();
  });
});

// UX-R6 manual annotation: "Add text here…" places a NEW annotation at the
// right-click's DATA position (not a second decoration model — the same
// `addAnnotation` store action the Inspector's Annotations card and the
// toolbar's "Text box" tool already write to).
describe("PlotContextMenu — 'Add text here…' (UX-R6 manual annotation)", () => {
  it("creates exactly one annotation at the clicked DATA position, with one undo entry", async () => {
    mockAskAnnotationText.mockResolvedValue("Tc onset");
    open();
    fireEvent.click(screen.getByText("Add text here…"));
    // fakePlot's rect is [100,100]→[500,400] and posToVal is identity, so a
    // click at client (300,250) is data (200, 150) — see the module doc.
    expect(mockAskAnnotationText).toHaveBeenCalledWith("Add text", "");
    await waitFor(() => expect(useApp.getState().annotations).toHaveLength(1));
    const ann = useApp.getState().annotations[0];
    expect(ann).toMatchObject({ x: 200, y: 150, text: "Tc onset" });
    expect(useApp.getState().selectedAnnotationId).toBe(ann.id);
    // ONE undo entry for this one gesture (the setGroupKey precedent) — not
    // a create-then-separate-edit double entry.
    expect(useApp.getState().history).toHaveLength(1);
    expect(useApp.getState().history[0]?.label).toBe("add annotation");
  });

  it("closes the menu immediately (single-shot) without waiting for the dialog", () => {
    const onClose = open();
    fireEvent.click(screen.getByText("Add text here…"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("creates NO annotation and records no undo entry when the dialog is cancelled", async () => {
    mockAskAnnotationText.mockResolvedValue(null);
    open();
    fireEvent.click(screen.getByText("Add text here…"));
    // askAnnotationText is called SYNCHRONOUSLY inside the click handler —
    // no waitFor needed for the call itself (weak-wait ratchet,
    // architecture.test.ts: wait on RESOLVED STATE, not the mock call).
    // Flush the resolved-null `.then()` microtask, then assert on state.
    expect(mockAskAnnotationText).toHaveBeenCalled();
    await act(async () => {
      await Promise.resolve();
    });
    expect(useApp.getState().annotations).toEqual([]);
    expect(useApp.getState().history).toEqual([]);
    expect(useApp.getState().selectedAnnotationId).toBeNull();
  });

  // B1 (ruling): a successful create must flip the active plot tool to
  // "pointer" (MAIN #27's "immediately selected + directly manipulable"
  // contract — useAnnotationEdit.ts / SelectionMiniToolbar.tsx both hide the
  // selection under any non-pointer tool), but a CANCELLED dialog must leave
  // the user's active tool untouched.
  it("B1: flips the plot tool to pointer after a successful create", async () => {
    mockAskAnnotationText.mockResolvedValue("Tc onset");
    useApp.setState({ plotTool: "zoom" });
    open();
    fireEvent.click(screen.getByText("Add text here…"));
    await waitFor(() => expect(useApp.getState().annotations).toHaveLength(1));
    expect(useApp.getState().plotTool).toBe("pointer");
  });

  it("B1: leaves the plot tool unchanged when the dialog is cancelled", async () => {
    mockAskAnnotationText.mockResolvedValue(null);
    useApp.setState({ plotTool: "zoom" });
    open();
    fireEvent.click(screen.getByText("Add text here…"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(useApp.getState().annotations).toEqual([]);
    expect(useApp.getState().plotTool).toBe("zoom");
  });

  // B3: an empty or whitespace-only "Done" must be treated exactly like
  // Cancel — no annotation, no undo entry, no selection, no tool flip — the
  // same guard AnnotationsCard.tsx already applies (`text.trim()`).
  it("B3: an empty-string 'Done' creates no annotation and no undo entry", async () => {
    mockAskAnnotationText.mockResolvedValue("");
    useApp.setState({ plotTool: "zoom" });
    open();
    fireEvent.click(screen.getByText("Add text here…"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(useApp.getState().annotations).toEqual([]);
    expect(useApp.getState().history).toEqual([]);
    expect(useApp.getState().selectedAnnotationId).toBeNull();
    expect(useApp.getState().plotTool).toBe("zoom");
  });

  it("B3: a whitespace-only 'Done' creates no annotation and no undo entry", async () => {
    mockAskAnnotationText.mockResolvedValue("   ");
    useApp.setState({ plotTool: "zoom" });
    open();
    fireEvent.click(screen.getByText("Add text here…"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(useApp.getState().annotations).toEqual([]);
    expect(useApp.getState().history).toEqual([]);
    expect(useApp.getState().selectedAnnotationId).toBeNull();
    expect(useApp.getState().plotTool).toBe("zoom");
  });

  // B2: the pixel→data conversion must be computed ONCE at menu-open time
  // (inside the same useMemo that already builds the hit-test), not
  // recomputed at menu-ITEM-click time — otherwise a live-updating/
  // re-autoscaling plot (store/liveWindowDocument.ts) that re-ranges WHILE
  // the menu is open makes the same pixel map to a different data point.
  it("B2: pins the pixel→data conversion at menu-open time, not item-click time", async () => {
    mockAskAnnotationText.mockResolvedValue("pinned");
    const { plot, scale } = fakePlotWithMutableScale();
    render(
      <PlotContextMenu
        x={300}
        y={250}
        plotRef={{ current: plot }}
        payload={payload}
        plotted={[0, 1]}
        hidden={[false, false]}
        actions={actions}
        onClose={vi.fn()}
      />,
    );
    // The plot re-ranges WHILE the menu sits open (autoscale/live-window) —
    // AFTER the menu built its items, BEFORE the user picks "Add text here…".
    scale.shift = 1000;
    fireEvent.click(screen.getByText("Add text here…"));
    await waitFor(() => expect(useApp.getState().annotations).toHaveLength(1));
    const ann = useApp.getState().annotations[0];
    // Must land at the ORIGINAL open-time coordinates (200, 150 — same as
    // the other "Add text here…" tests), NOT the re-ranged (1200, 1150).
    expect(ann).toMatchObject({ x: 200, y: 150 });
  });
});
