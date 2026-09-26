// Richer saved custom models (audit P2.7 slice 3): a description and
// per-parameter units are saved as a v2 record, shown in the picker and the
// table, and the units appear beside fitted values. Unreadable stored
// records are skipped with ONE warning.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitEquation, listFitModels, validateEquation } from "../../../lib/api/curvefit";
import { loadCustomModels, saveCustomModel, type CustomFitModel } from "../../../lib/fitmodels";
import type { DataStruct } from "../../../lib/types";
import { useToasts } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import CurveFitPanel from "./CurveFitPanel";
import EquationModelPanel from "./EquationModelPanel";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: vi.fn(),
  fetchBookData: vi.fn(),
  reportEmit: vi.fn(),
}));
vi.mock("../../../lib/api/curvefit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/curvefit")>()),
  listFitModels: vi.fn(),
  validateEquation: vi.fn(),
  fitEquation: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[10], [20], [30], [40]],
  labels: ["y"],
  units: [""],
  metadata: {},
};

const DECAY: CustomFitModel = {
  version: 2,
  name: "Decay",
  equation: "a*exp(-x/t)",
  params: ["a", "t"],
  guesses: [2, 1],
  lower: [null, 0],
  upper: [null, null],
  description: "single exponential decay",
  units: ["V", "s"],
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useToasts.setState({ toasts: [] });
  vi.mocked(listFitModels).mockResolvedValue({ models: [] });
  vi.mocked(validateEquation).mockResolvedValue({
    ok: true,
    params: ["a", "t"],
    variable: "x",
    usesX: true,
    functions: ["exp"],
    constants: [],
  });
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    seriesOrder: null,
    errKeys: {},
    fitOverlay: null,
    curveFitOpen: true,
  });
});

describe("saved model description + units (P2.7 slice 3)", () => {
  it("prefills units and shows the description; fitted values carry their unit", async () => {
    vi.mocked(fitEquation).mockResolvedValue({
      params: [2.5, 1.7],
      errors: [0.01, null],
      yFit: [1, 2, 3, 4],
      paramNames: ["a", "t"],
    });
    render(<EquationModelPanel initial={DECAY} onSavedChange={() => {}} />);
    expect(screen.getByLabelText("model description")).toHaveValue("single exponential decay");
    expect(screen.getByLabelText("unit a")).toHaveValue("V");
    expect(screen.getByLabelText("unit t")).toHaveValue("s");
    // The mount re-validate must settle before Fit is enabled.
    await screen.findByLabelText("equation summary");

    fireEvent.click(screen.getByLabelText("Hold t fixed"));
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    const results = await screen.findByRole("columnheader", { name: "± err" });
    const table = results.closest("table") as HTMLElement;
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("a2.5 V0.01 V");
    expect(rows[2]).toHaveTextContent("t1.7 sheld");
  });

  it("saves the description and units as a v2 record", async () => {
    render(<EquationModelPanel initial={null} onSavedChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("Equation"), { target: { value: "a*exp(-x/t)" } });
    fireEvent.change(await screen.findByLabelText("unit t"), { target: { value: "s" } });
    fireEvent.change(screen.getByPlaceholderText("model name"), { target: { value: "Mine" } });
    fireEvent.change(screen.getByLabelText("model description"), { target: { value: "my decay" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(loadCustomModels()).toEqual([
      {
        version: 2,
        name: "Mine",
        equation: "a*exp(-x/t)",
        params: ["a", "t"],
        guesses: [1, 1],
        lower: [null, null],
        upper: [null, null],
        description: "my decay",
        units: ["", "s"],
      },
    ]);
  });

  it("the picker names a saved model with the start of its description", async () => {
    saveCustomModel(DECAY);
    render(<CurveFitPanel />);
    expect(await screen.findByRole("option", { name: "ƒ Decay — single exponential decay" })).toBeInTheDocument();
  });

  it("skips an unreadable stored model with ONE warning, however often the panel mounts", async () => {
    saveCustomModel(DECAY);
    localStorage.setItem(
      "qz.customFitModels",
      JSON.stringify([...JSON.parse(localStorage.getItem("qz.customFitModels") ?? "[]"), { version: 9, name: "Future" }]),
    );
    const first = render(<CurveFitPanel />);
    await waitFor(() => expect(useToasts.getState().toasts).toHaveLength(1));
    expect(useToasts.getState().toasts[0].msg).toContain('"Future"');
    expect(await screen.findByRole("option", { name: /Decay/ })).toBeInTheDocument();
    first.unmount();
    render(<CurveFitPanel />);
    await screen.findByRole("option", { name: /Decay/ });
    expect(useToasts.getState().toasts).toHaveLength(1);
  });
});
