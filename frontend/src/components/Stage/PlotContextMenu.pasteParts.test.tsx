// Plan item 42: the graph's right-click menu offers "Paste format (choose parts)…", and it reaches the
// parts dialog and the store through the real lazy path.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import { copyStageFormat, resetCopiedFormatForTests } from "../../lib/graphTemplateCommands";
import type { PlotPayload } from "../../lib/plotdata";
import { defaultPlotView } from "../../lib/plotview";
import { askParams } from "../../store/paramDialog";
import { useApp } from "../../store/useApp";
import PlotContextMenu from "./PlotContextMenu";
import type { PlotStageActions } from "./usePlotStageActions";

vi.mock("../../store/paramDialog", () => ({ askParams: vi.fn() }));
vi.mock("../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

function fakePlot(): uPlot {
  return {
    over: { getBoundingClientRect: () => ({ left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300 }) },
    data: [[0, 100, 200], [10, 20, 150]],
    series: [{}, { scale: "y" }],
    scales: { x: { min: 0, max: 400 }, y: { min: 8, max: 32 } },
    posToVal: (px: number) => px,
    valToPos: (v: number) => v,
  } as unknown as uPlot;
}

const payload = { series: [{ label: "A", unit: "" }] } as unknown as PlotPayload;
const actions = { resetView: vi.fn() } as unknown as PlotStageActions;

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetCopiedFormatForTests();
  localStorage.clear();
  const ds = { id: "a", name: "a.csv", data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["A"], units: [""], metadata: {} } };
  useApp.setState({ ...defaultPlotView(), datasets: [ds], activeId: "a", history: [], future: [], status: "" });
});

describe("PlotContextMenu: Paste format (choose parts)…", () => {
  it("opens the parts dialog and pastes only the ticked part, as one undo step", async () => {
    useApp.setState({ yScale: "log", showGrid: false });
    copyStageFormat(useApp.getState);
    useApp.setState({ yScale: "linear", showGrid: true });
    vi.mocked(askParams).mockImplementation((_t, fields) => Promise.resolve(Object.fromEntries(fields.map((f) => [f.key, f.key === "scalesY"]))));
    render(<PlotContextMenu x={300} y={250} plotRef={{ current: fakePlot() }} payload={payload} plotted={[0]} hidden={[false]} actions={actions} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Paste format (choose parts)…"));
    await waitFor(() => expect(useApp.getState().yScale).toBe("log"));
    await act(async () => {});
    expect(useApp.getState().showGrid).toBe(true); // the grid part was not ticked
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(useApp.getState().yScale).toBe("linear");
  });
});
