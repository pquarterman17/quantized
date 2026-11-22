// Signal Processing's "Use excluded/filtered rows" option. ON (the default) is
// the tool's long-standing full-worksheet input; OFF runs the single run on the
// analysis view. The choice is recorded in the recipe (`inputRows`), so the
// preview key, the commit and the saved recipe all change with it.

import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useSignalOperationSeed } from "../../../store/signalOperationSeed";
import { useApp } from "../../../store/useApp";
import SignalProcessingPanel from "./SignalProcessingPanel";

const { correctionMock, createSignalMock, saveRecipeMock, askParamsMock } = vi.hoisted(() => ({
  correctionMock: vi.fn(), createSignalMock: vi.fn(), saveRecipeMock: vi.fn(), askParamsMock: vi.fn(),
}));

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  applyCorrections: correctionMock,
}));
vi.mock("../../../lib/api/spectralWorkbench", () => ({ runSpectralWorkbench: vi.fn() }));
vi.mock("../../../store/signalWorksheetCommand", () => ({ createSignalWorksheetFromApp: createSignalMock }));
vi.mock("../../overlays/ParamDialog", () => ({ askParams: askParamsMock }));
vi.mock("../../../lib/signalRecipeTemplate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/signalRecipeTemplate")>()),
  saveSignalRecipeTemplate: saveRecipeMock,
}));
vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => <section aria-label={title}>{children}</section>,
}));

// Row 1 is manually excluded; row 3 fails the Data Filter (time > 3.5).
const SHEET: Dataset = {
  id: "s1",
  name: "scan",
  data: {
    time: [1, 2, 3, 4],
    values: [[10], [20], [30], [40]],
    labels: ["primary"],
    units: ["V"],
    metadata: { xUnit: "s" },
  },
  excludedRows: [1],
  filter: [{ col: -1, kind: "range", max: 3.5 }],
};

const checkbox = () => screen.getByRole("checkbox", { name: "Use excluded/filtered rows" });
const lastRequestRows = () => (correctionMock.mock.calls.at(-1)?.[0] as { dataset: Dataset["data"] }).dataset.time;

beforeEach(() => {
  vi.clearAllMocks();
  useSignalOperationSeed.setState({ op: null, nonce: 0 });
  correctionMock.mockImplementation(async ({ dataset }: { dataset: Dataset["data"] }) => structuredClone(dataset));
  createSignalMock.mockResolvedValue(null);
  askParamsMock.mockResolvedValue({ name: "r" });
  saveRecipeMock.mockReturnValue({ name: "r", revision: 1 });
  useApp.setState({ datasets: [SHEET], activeId: SHEET.id, yKeys: [0], signalProcessingOpen: true, history: [], future: [] });
});

describe("Signal Processing row option", () => {
  it("defaults to the full worksheet: every row is sent, the line says so, the recipe has no row key", async () => {
    render(<SignalProcessingPanel />);
    expect(checkbox()).toBeChecked();
    const create = screen.getByRole("button", { name: "Create new worksheet" });
    await waitFor(() => expect(create).toBeEnabled());
    expect(lastRequestRows()).toEqual([1, 2, 3, 4]);
    const line = screen.getByLabelText("Analysis input");
    expect(line).toHaveTextContent("4 of 4 rows");
    expect(line).toHaveTextContent("Uses every row, including 2 excluded or filtered-out rows.");
    fireEvent.click(create);
    expect(createSignalMock).toHaveBeenCalledTimes(1);
    expect(createSignalMock.mock.calls[0][1]).not.toHaveProperty("inputRows");
  });

  it("off: the single run uses the analysis view, the summary and note say so, and the recipe records it", async () => {
    render(<SignalProcessingPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Create new worksheet" })).toBeEnabled());
    fireEvent.click(checkbox());
    expect(checkbox()).not.toBeChecked();
    const create = screen.getByRole("button", { name: "Create new worksheet" });
    await waitFor(() => expect(lastRequestRows()).toEqual([1, 3]));
    await waitFor(() => expect(create).toBeEnabled());
    const line = screen.getByLabelText("Analysis input");
    expect(line).toHaveTextContent("2 of 4 rows");
    expect(line).toHaveTextContent("Excluded and filtered-out rows are left out (1 excluded row, 1 filtered-out row).");
    fireEvent.click(create);
    expect(createSignalMock).toHaveBeenCalledTimes(1);
    expect(createSignalMock.mock.calls[0][1]).toMatchObject({ kind: "signal-correction", inputRows: "analysis-view" });
  });

  it("toggling changes the commit key: the old preview is dropped and a new one is required", async () => {
    render(<SignalProcessingPanel />);
    const create = screen.getByRole("button", { name: "Create new worksheet" });
    await waitFor(() => expect(create).toBeEnabled());
    const gate: { release: (() => void) | null } = { release: null };
    correctionMock.mockImplementationOnce(({ dataset }: { dataset: Dataset["data"] }) =>
      new Promise((resolve) => { gate.release = () => resolve(structuredClone(dataset)); }));
    fireEvent.click(checkbox());
    // The full-worksheet preview must not be committable as the analysis-view recipe.
    expect(create).toBeDisabled();
    await waitFor(() => expect(gate.release).not.toBeNull());
    await act(async () => gate.release?.());
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(checkbox());
    expect(create).toBeDisabled();
    await waitFor(() => expect(create).toBeEnabled());
    expect(lastRequestRows()).toEqual([1, 2, 3, 4]);
  });

  it("a saved recipe carries the row choice", async () => {
    render(<SignalProcessingPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Create new worksheet" })).toBeEnabled());
    fireEvent.click(checkbox());
    await waitFor(() => expect(lastRequestRows()).toEqual([1, 3]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save recipe…" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save recipe…" }));
    await waitFor(() => expect(useApp.getState().status).toContain("saved recipe"));
    expect(saveRecipeMock.mock.calls[0][2]).toMatchObject({ inputRows: "analysis-view" });
  });
});
