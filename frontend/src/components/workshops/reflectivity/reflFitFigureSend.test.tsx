// P2.2 — "Send to figure page": a live or saved fit becomes editable figures
// on a saved Figure Page bound to its fit-curve datasets, opened in the Figure
// Page workshop, as one undo step.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reflFit, reflPresets } from "../../../lib/api/reflectivity";
import { useApp } from "../../../store/useApp";
import { savedCurves } from "./reflFitCurves";
import { encodeRecord } from "./reflFitRecord";
import { fitResponse, makeRecord, TEST_PRESETS, xrrDataset } from "./reflFit.testkit";
import ReflFitView from "./ReflFitView";
import { useReflFit } from "./useReflFit";
import { useReflectivity } from "./useReflectivity";

vi.mock("uplot", async () => ({ default: (await import("./reflFit.testkit")).UPlotStub }));
vi.mock("../../../lib/api/reflectivity", () => ({
  reflPresets: vi.fn(),
  reflSimulate: vi.fn(),
  reflSldProfile: vi.fn(),
  reflFit: vi.fn(),
}));

function Harness() {
  const refl = useReflectivity();
  const fit = useReflFit(refl);
  return <ReflFitView fit={fit} />;
}

const realResolve = useApp.getState().resolveDataset;
const SEND = { name: "Send to figure page" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reflPresets).mockResolvedValue({ presets: TEST_PRESETS });
  useApp.setState({
    datasets: [xrrDataset("xrr")],
    activeId: "xrr",
    status: "",
    fitOverlay: null,
    reflectivitySeed: null,
    editableFigures: [],
    pages: [],
    pageDocSeed: null,
    figurePageOpen: false,
    history: [],
    future: [],
    resolveDataset: realResolve,
  });
});

async function runLiveFit() {
  vi.mocked(reflFit).mockResolvedValueOnce(fitResponse());
  render(<Harness />);
  const run = await screen.findByRole("button", { name: "Run fit" });
  await waitFor(() => expect(run).toHaveProperty("disabled", false));
  fireEvent.click(run);
  await screen.findByRole("button", SEND);
}

describe("Send to figure page", () => {
  it("binds figures to the fit-curve datasets, saves the page and opens it", async () => {
    await runLiveFit();
    fireEvent.click(screen.getByRole("button", SEND));
    await waitFor(() => expect(useApp.getState().pages).toHaveLength(1));
    const s = useApp.getState();
    const [model, sld] = s.datasets.slice(1);
    expect(model.data.labels).toEqual(["R", "R fit", "residual"]);
    expect(s.editableFigures.map((f) => [f.name, f.bindings.datasetId])).toEqual([
      ["film.refl — refl fit #1 R(Q)", model.id],
      ["film.refl — refl fit #1 residuals", model.id],
      ["film.refl — refl fit #1 SLD", sld.id],
    ]);
    const [page] = s.pages;
    expect(page.panels.map((p) => p.figureId)).toEqual(s.editableFigures.map((f) => f.id));
    expect(s.figurePageOpen).toBe(true);
    expect(s.pageDocSeed?.id).toBe(page.id);
    expect(screen.getByRole("button", { name: "Fit curves added" })).toBeTruthy();

    // One undo takes the page and its figures back, and leaves the curves.
    s.undo();
    const after = useApp.getState();
    expect([after.pages.length, after.editableFigures.length, after.datasets.length]).toEqual([0, 0, 3]);
  });

  it("re-adds fit curves that were deleted since, so no figure is bound to a dataset that is gone", async () => {
    await runLiveFit();
    fireEvent.click(screen.getByRole("button", { name: "Add fit curves" }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(3));
    useApp.setState((s) => ({ datasets: s.datasets.slice(0, 1) }));
    await screen.findByRole("button", { name: "Add fit curves" }); // enabled again
    fireEvent.click(screen.getByRole("button", SEND));
    await waitFor(() => expect(useApp.getState().pages).toHaveLength(1));
    const { datasets, editableFigures } = useApp.getState();
    const ids = new Set(datasets.map((d) => d.id));
    expect(editableFigures.every((f) => ids.has(f.bindings.datasetId as string))).toBe(true);
  });

  it("works for a saved fit too, from its stored curves", async () => {
    const rec = { ...makeRecord(), curves: savedCurves(fitResponse()) };
    useApp.setState({ datasets: [xrrDataset("xrr", { reflFits: [encodeRecord(rec)] })] });
    render(<Harness />);
    await screen.findByLabelText("saved fit");
    fireEvent.click(screen.getByRole("button", SEND));
    await waitFor(() => expect(useApp.getState().pages).toHaveLength(1));
    expect(useApp.getState().editableFigures.map((f) => f.name)).toEqual([
      "film.refl — refl fit #1 R(Q)",
      "film.refl — refl fit #1 residuals",
      "film.refl — refl fit #1 SLD",
    ]);
    expect(reflFit).not.toHaveBeenCalled();
  });
});
