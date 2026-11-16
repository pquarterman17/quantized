// Origin gap audit 3 #15: Insert ▸ Inset graph / Table / Image, and Layer
// properties — position typed in % of the plot, an inset's curves (any
// dataset, Layer Contents' picker) and axes, a table's cells typed or filled
// from worksheet rows. Apply is ONE undo step; Cancel changes nothing; a bad
// field holds Apply back.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildPlotCommands } from "../../../commands/plotCommands";
import { imageLayerFromFile, insertGraphLayer } from "../../../lib/graphLayerCommands";
import { MAX_IMAGE_CHARS, MAX_LAYERS, sanitizeLayers, type GraphLayer, type InsetLayer, type TableLayer } from "../../../lib/graphLayers";
import type { Dataset } from "../../../lib/types";
import { openFigureDialog, useFigureDialog } from "../../../store/figureDialogs";
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
  it("is in the Insert menu and opens a DRAFT in Layer properties: nothing is added before Apply", async () => {
    const cmd = buildPlotCommands(st).find((c) => c.id === "insert-inset")!;
    expect(cmd).toMatchObject({ group: "Insert", label: "Inset graph…" });
    void cmd.run();
    await waitFor(() => expect(useFigureDialog.getState().open).toMatchObject({ kind: "graphLayer" }));
    render(<FigureDialogs />);
    expect(screen.getByRole("dialog", { name: "Layer properties" })).toBeInTheDocument();
    expect(st().layers).toEqual([]);
    expect(st().history).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Delete layer" })).toBeNull();
  });

  it("Cancel after Insert leaves no empty inset behind (review L1)", () => {
    insertGraphLayer("inset");
    render(<FigureDialogs />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(st().layers).toEqual([]);
    expect(st().history).toHaveLength(0);
  });

  it("refuses past the export's layer cap (review L4)", () => {
    useApp.setState({ layers: Array.from({ length: MAX_LAYERS }, (_, i) => ({ id: `t${i}`, kind: "table", at: [0, 0, 0.1, 0.1], rows: [["a"]], header: false })) });
    insertGraphLayer("inset");
    expect(useFigureDialog.getState().open).toBeNull();
    expect(st().layers).toHaveLength(MAX_LAYERS);
  });

  it("adds another dataset's curve, types the position and axes, and applies as ONE undo step", () => {
    insertGraphLayer("inset");
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
    expect(l.curves).toMatchObject([{ datasetId: "loop", yKey: 0 }, { datasetId: "loop", yKey: 1 }, { datasetId: "dmdh", xKey: null, yKey: 0 }]);
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

describe("Insert ▸ Inset graph: starting curves", () => {
  const draftCurves = () => {
    const open = useFigureDialog.getState().open;
    return open?.kind === "graphLayer" ? (open.draft as InsetLayer).curves : null;
  };

  it("starts with the active graph's visible curves, not empty", () => {
    insertGraphLayer("inset");
    expect(draftCurves()).toMatchObject([{ datasetId: "loop", xKey: null, yKey: 0 }, { datasetId: "loop", xKey: null, yKey: 1 }]);
  });

  it("skips a hidden curve", () => {
    useApp.setState({ hiddenChannels: [0] });
    insertGraphLayer("inset");
    expect(draftCurves()).toMatchObject([{ datasetId: "loop", yKey: 1 }]);
    useApp.setState({ hiddenChannels: [] });
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

  it("Delete layer removes an applied one", () => {
    insertGraphLayer("table");
    const { unmount } = render(<FigureDialogs />);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    unmount();
    expect(st().layers).toHaveLength(1);
    openFigureDialog({ kind: "graphLayer", id: st().layers[0].id });
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
    raster: vi.fn(async () => "data:image/png;base64,iVBORw0KGgoAAAA"),
  };
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

  it("places a PNG sized to its aspect", async () => {
    const out = await imageLayerFromFile(new File([PNG], "tem.png"), deps);
    expect(out).toMatchObject({ kind: "image", name: "tem.png", at: [0.06, 0.56, 0.3, 0.24] });
    expect(typeof out !== "string" && out.src.startsWith("data:image/png;base64,iVBORw0KGgo")).toBe(true);
    expect(typeof out !== "string" && out.raster).toBeUndefined();
  });

  it("reads the type from the BYTES: a JPEG saved as .png is a JPEG (review M2)", async () => {
    const out = await imageLayerFromFile(new File([JPEG], "photo.png", { type: "image/png" }), deps);
    expect(typeof out !== "string" && out.src.startsWith("data:image/jpeg;base64,/9j/")).toBe(true);
    // ...and the persisted layer survives every reader (its bytes match its label).
    expect(sanitizeLayers([out])).toHaveLength(1);
  });

  it("refuses a file whose bytes are no image, whatever its name (review M2)", async () => {
    expect(await imageLayerFromFile(new File(["GIF89a...."], "anim.png"), deps)).toMatch(/not a PNG, JPEG or SVG/);
    expect(await imageLayerFromFile(new File(["a,b"], "data.csv"), deps)).toMatch(/not a PNG, JPEG or SVG/);
  });

  it("refuses a file the browser cannot decode", async () => {
    const broken = { ...deps, load: vi.fn(async () => Promise.reject(new Error("bad"))) };
    expect(await imageLayerFromFile(new File([PNG], "broken.png"), broken)).toMatch(/could not be read/);
  });

  it("refuses an image over 25 megapixels before it is placed (review M6)", async () => {
    const huge = { ...deps, load: vi.fn(async () => ({ naturalWidth: 16000, naturalHeight: 16000 })) };
    expect(await imageLayerFromFile(new File([PNG], "bomb.png"), huge)).toMatch(/too large/);
  });

  it("refuses a file over the size cap without reading it (review L5)", async () => {
    const big = new File([PNG], "big.png");
    Object.defineProperty(big, "size", { value: MAX_IMAGE_CHARS });
    expect(await imageLayerFromFile(big, deps)).toMatch(/too large/);
    expect(deps.load).not.toHaveBeenCalledWith(expect.stringContaining("big"));
  });

  it("keeps an SVG's PNG rendering for the export; a rendering too large is refused, not lost (review L5)", async () => {
    const out = await imageLayerFromFile(new File(["<svg/>"], "scheme.svg"), deps);
    expect(out).toMatchObject({ src: expect.stringMatching(/^data:image\/svg\+xml;base64,/), raster: "data:image/png;base64,iVBORw0KGgoAAAA" });
    const fat = { ...deps, raster: vi.fn(async (_i: unknown, _s: string, px: number) => `data:image/png;base64,iVBORw0KGgo${"A".repeat(px > 800 ? MAX_IMAGE_CHARS : 10)}`) };
    expect(await imageLayerFromFile(new File(["<svg/>"], "scheme.svg"), fat)).toMatchObject({ raster: "data:image/png;base64,iVBORw0KGgoAAAAAAAAAA" });
    const always = { ...deps, raster: vi.fn(async () => `data:image/png;base64,iVBORw0KGgo${"A".repeat(MAX_IMAGE_CHARS)}`) };
    expect(await imageLayerFromFile(new File(["<svg/>"], "scheme.svg"), always)).toMatch(/too large/);
  });

  it("the command picks a file and adds the image", async () => {
    const pick = vi.fn((cb: (f: File[]) => void) => cb([new File([PNG], "a.png")]));
    insertGraphLayer("image", pick as never, deps);
    expect(pick).toHaveBeenCalled();
    await waitFor(() => expect(st().layers.map((l) => l.kind)).toEqual(["image"]));
  });
});
