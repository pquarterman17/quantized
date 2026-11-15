// Origin gap audit 3 #15: Insert ▸ Inset graph / Table / Image, and Layer
// properties — position typed in % of the plot, an inset's curves (any
// dataset, Layer Contents' picker) and axes, a table's cells typed or filled
// from worksheet rows. Apply is ONE undo step; Cancel changes nothing; a bad
// field holds Apply back.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildPlotCommands } from "../../../commands/plotCommands";
import { imageLayerFromFile, insertGraphLayer } from "../../../lib/graphLayerCommands";
import type { GraphLayer, InsetLayer, TableLayer } from "../../../lib/graphLayers";
import type { Dataset } from "../../../lib/types";
import { useFigureDialog } from "../../../store/figureDialogs";
import { useApp } from "../../../store/useApp";
import FigureDialogs from "./FigureDialogs";

const loop: Dataset = {
  id: "loop", name: "M(H)",
  data: { time: [0, 1, 2], values: [[100, 1], [0, 0], [-100, -1]], labels: ["H", "M"], units: ["Oe", "emu"], metadata: {} },
};
const deriv: Dataset = {
  id: "dmdh", name: "dMdH",
  data: { time: [-50, 0, 50], values: [[1], [8], [1]], labels: ["dM"], units: [""], metadata: {} },
};
const st = () => useApp.getState();
const only = <K extends GraphLayer["kind"]>(kind: K) => st().layers.find((l) => l.kind === kind) as Extract<GraphLayer, { kind: K }>;

beforeEach(() => {
  useFigureDialog.setState({ open: null });
  useApp.setState({ datasets: [loop, deriv], activeId: "loop", layers: [], history: [], future: [], polarMode: false, statMode: false, stackMode: false });
});

describe("Insert ▸ Inset graph", () => {
  it("is in the Insert menu, adds an empty inset (one undo step) and opens its properties", async () => {
    const cmd = buildPlotCommands(st).find((c) => c.id === "insert-inset")!;
    expect(cmd).toMatchObject({ group: "Insert", label: "Inset graph…" });
    void cmd.run();
    await waitFor(() => expect(st().layers).toHaveLength(1));
    expect(only("inset")).toMatchObject({ kind: "inset", curves: [] });
    expect(st().history).toHaveLength(1);
    render(<FigureDialogs />);
    expect(screen.getByRole("dialog", { name: "Layer properties" })).toBeInTheDocument();
  });

  it("adds another dataset's curve, types the position and axes, and applies as ONE undo step", () => {
    insertGraphLayer("inset");
    useApp.setState({ history: [], future: [] });
    render(<FigureDialogs />);
    fireEvent.change(screen.getByLabelText("New curve dataset"), { target: { value: "dmdh" } });
    fireEvent.click(screen.getByRole("button", { name: "Add curve" }));
    expect(screen.getByText("dMdH: dM vs its X")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Left (%)"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("X axis From"), { target: { value: "-60" } });
    fireEvent.change(screen.getByLabelText("X axis To"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("X axis Title"), { target: { value: "H (Oe)" } });
    fireEvent.change(screen.getByLabelText("Y axis scale"), { target: { value: "log" } });
    fireEvent.change(screen.getByLabelText("Draw as"), { target: { value: "linesymbol" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const l: InsetLayer = only("inset");
    expect(l.curves).toMatchObject([{ datasetId: "dmdh", xKey: null, yKey: 0 }]);
    expect(l.at[0]).toBeCloseTo(0.1);
    expect(l.x).toEqual({ lim: [-60, 60], scale: "linear", label: "H (Oe)", step: null });
    expect(l.y.scale).toBe("log");
    expect(l.mark).toBe("linesymbol");
    expect(st().history).toHaveLength(1);
    expect(useFigureDialog.getState().open).toBeNull();
  });

  it("picking the dataset already shown keeps its main channel, so Add stays available (live-check find)", () => {
    insertGraphLayer("inset");
    render(<FigureDialogs />);
    const picker = screen.getByLabelText("New curve dataset") as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: picker.value } });
    expect(screen.getByRole("button", { name: "Add curve" })).toBeEnabled();
  });

  it("a bad axis range holds Apply back and says why; Cancel changes nothing", () => {
    insertGraphLayer("inset");
    const before = JSON.stringify(st().layers);
    render(<FigureDialogs />);
    fireEvent.change(screen.getByLabelText("X axis From"), { target: { value: "5" } });
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(screen.getByText(/X axis: give both From and To/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(JSON.stringify(st().layers)).toBe(before);
  });
});

describe("Insert ▸ Table", () => {
  it("fills from worksheet rows, edits the cells and applies", () => {
    insertGraphLayer("table");
    render(<FigureDialogs />);
    fireEvent.change(screen.getByLabelText("Last row"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Fill" }));
    expect((screen.getByLabelText("Table cells") as HTMLTextAreaElement).value).toBe("X\tH\tM\n0\t100\t1\n1\t0\t0");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const t: TableLayer = only("table");
    expect(t.rows).toEqual([["X", "H", "M"], ["0", "100", "1"], ["1", "0", "0"]]);
    expect(t.header).toBe(true);
  });

  it("Delete layer removes it", () => {
    insertGraphLayer("table");
    render(<FigureDialogs />);
    fireEvent.click(screen.getByRole("button", { name: "Delete layer" }));
    expect(st().layers).toEqual([]);
  });

  it("refuses with no graph, and on a non-XY view", () => {
    useApp.setState({ activeId: null });
    insertGraphLayer("table");
    useApp.setState({ activeId: "loop", polarMode: true });
    insertGraphLayer("table");
    expect(st().layers).toEqual([]);
  });
});

describe("Insert ▸ Image", () => {
  const deps = {
    load: vi.fn(async () => ({ naturalWidth: 200, naturalHeight: 100 })),
    raster: vi.fn(async () => "data:image/png;base64,UE5H"),
  };
  it("places a PNG sized to its aspect", async () => {
    const out = await imageLayerFromFile(new File([new Uint8Array([137, 80, 78, 71])], "tem.png"), deps);
    expect(out).toMatchObject({ kind: "image", name: "tem.png", at: [0.06, 0.06, 0.3, 0.24] });
    expect(typeof out !== "string" && out.src.startsWith("data:image/png;base64,")).toBe(true);
    expect(typeof out !== "string" && out.raster).toBeUndefined();
  });

  it("keeps an SVG's PNG rendering for the export", async () => {
    const out = await imageLayerFromFile(new File(["<svg/>"], "scheme.svg"), deps);
    expect(out).toMatchObject({ src: expect.stringMatching(/^data:image\/svg\+xml;base64,/), raster: "data:image/png;base64,UE5H" });
  });

  it("refuses a file that is not an image", async () => {
    expect(await imageLayerFromFile(new File(["a,b"], "data.csv"), deps)).toMatch(/not a PNG, JPEG or SVG/);
  });

  it("the command picks a file and adds the image", async () => {
    const pick = vi.fn((cb: (f: File[]) => void) => cb([new File(["x"], "a.png")]));
    insertGraphLayer("image", pick as never, deps);
    expect(pick).toHaveBeenCalled();
    await waitFor(() => expect(st().layers.map((l) => l.kind)).toEqual(["image"]));
  });
});
