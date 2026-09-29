// The Quick Figure Builder's "Right -- concise setup" panel
// (QuickFigureSetupPanel.tsx): detected series, plot style, colour preset,
// lines/markers, axes, legend, and error bars -- shown in the live preview and
// carried by Create Editable Figure and Save Quick Plot Template. The pure look
// is pinned in lib/quickFigureSetup.test.ts and the store merge in
// store/quickFigureSetup.test.ts.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { askParams } from "../../overlays/ParamDialog";
import { PALETTES } from "../../../lib/palettes";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import QuickFigureBuilderWorkspace from "./QuickFigureBuilderWorkspace";

vi.mock("../../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

const dataset: Dataset = {
  id: "s1",
  name: "sweep.csv",
  data: {
    time: [0, 1, 2],
    values: [[1, 10, 0.5, 30], [2, 20, 0.6, 40], [3, 30, 0.7, 50]],
    labels: ["H", "M", "M_err", "T"],
    units: ["Oe", "emu", "emu", "K"],
    metadata: { technique: "generic" },
  },
};

beforeEach(() => {
  vi.mocked(askParams).mockReset();
  useApp.setState({
    datasets: [dataset],
    quickFigureBuilderDatasetId: "s1",
    editableFigures: [],
    plotWindows: [],
    quickPlotTemplates: [],
    cmdkOpen: false,
  });
});

const select = (name: string) => screen.getByRole("combobox", { name });
const change = (name: string, value: string) => fireEvent.change(select(name), { target: { value } });
const okabe = PALETTES.find((p) => p.value === "okabe-ito")!.colors!;

describe("Quick Figure Builder — concise setup panel", () => {
  it("lists the detected series against their X", () => {
    render(<QuickFigureBuilderWorkspace />);
    const series = screen.getByLabelText("Detected series");
    expect(series).toHaveTextContent("H vs Acquisition axis");
    expect(series).toHaveTextContent("M vs Acquisition axis");
    expect(series).toHaveTextContent("T vs Acquisition axis");
  });

  it("every setting reaches the created figure", () => {
    render(<QuickFigureBuilderWorkspace />);
    change("Plot style", "line-symbol");
    change("Colour preset", "okabe-ito");
    change("Line width", "2");
    change("Line style", "dotted");
    change("Marker", "triangle");
    change("Marker size", "9");
    change("X axis", "log");
    change("Y axis", "log");
    change("Legend", "nw");
    fireEvent.click(screen.getByRole("checkbox", { name: "Grid" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Error bars" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Editable Figure" }));

    const [doc] = useApp.getState().editableFigures;
    const view = doc.plot.view;
    expect(view).toMatchObject({ xScale: "log", yScale: "log", showGrid: false, showLegend: true, legendPos: "nw" });
    // M (channel 1) is the second plotted series: H, M, T.
    expect(view.seriesStyles[1]).toEqual({
      marker: true, width: 2, line: "dotted", markerShape: "triangle", markerSize: 9, color: okabe[1],
    });
    expect(doc.bindings.errors).toEqual([]);
  });

  it("a hidden legend leaves the preview without one and the figure with showLegend off", () => {
    render(<QuickFigureBuilderWorkspace />);
    expect(screen.getByLabelText("Preview legend")).toHaveClass("ne");
    change("Legend", "se");
    expect(screen.getByLabelText("Preview legend")).toHaveClass("se");
    change("Legend", "off");
    expect(screen.queryByLabelText("Preview legend")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create Editable Figure" }));
    expect(useApp.getState().editableFigures[0].plot.view.showLegend).toBe(false);
  });

  it("settings that cannot apply are disabled with a reason", () => {
    render(<QuickFigureBuilderWorkspace />);
    expect(select("Marker")).toBeDisabled(); // the default Line style draws no markers
    expect(select("Marker").closest("label")).toHaveAttribute("title", "Markers apply to the Scatter and Line + symbol styles.");
    change("Plot style", "scatter");
    expect(select("Marker")).toBeEnabled();
    expect(select("Line width")).toBeDisabled();
  });

  it("Save Quick Plot Template carries the setup, and Quick Plot With re-applies it", async () => {
    vi.mocked(askParams).mockResolvedValue({ name: "Log look" });
    render(<QuickFigureBuilderWorkspace />);
    change("Y axis", "log");
    change("Colour preset", "okabe-ito");
    fireEvent.click(screen.getByRole("button", { name: "Save Quick Plot Template…" }));
    await waitFor(() => expect(useApp.getState().quickPlotTemplates).toHaveLength(1));
    const [template] = useApp.getState().quickPlotTemplates;
    expect(template.look?.yScale).toBe("log");
    expect(useApp.getState().applyQuickPlotTemplate(template.id, "s1")).toBe(true);
    const view = useApp.getState().editableFigures[0].plot.view;
    expect(view.yScale).toBe("log");
    expect(view.seriesStyles[0].color).toBe(okabe[0]);
  });
});
