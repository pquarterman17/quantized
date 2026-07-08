import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct, ImportFilterWire, ImportPreviewResponse, ImportSettingsWire } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import ParamDialog from "../../overlays/ParamDialog";
import ImportWizardPanel from "./ImportWizardPanel";

const {
  importGuessMock,
  importPreviewMock,
  importParseMock,
  listImportFiltersMock,
  saveImportFilterMock,
  deleteImportFilterMock,
} = vi.hoisted(() => ({
  importGuessMock: vi.fn(),
  importPreviewMock: vi.fn(),
  importParseMock: vi.fn(),
  listImportFiltersMock: vi.fn(),
  saveImportFilterMock: vi.fn(),
  deleteImportFilterMock: vi.fn(),
}));

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  importGuess: importGuessMock,
  importPreview: importPreviewMock,
  importParse: importParseMock,
  listImportFilters: listImportFiltersMock,
  saveImportFilter: saveImportFilterMock,
  deleteImportFilter: deleteImportFilterMock,
}));

const SETTINGS: ImportSettingsWire = {
  delimiter: "auto",
  header_line: 1,
  units_line: 2,
  data_start_line: 3,
  column_names: ["Temp", "Moment"],
  roles: ["x", "y"],
};

const PREVIEW: ImportPreviewResponse = {
  raw_lines: ["# header comment", "Temp,Moment", "(K),(emu)", "300,0.0012"],
  n_lines: 4,
  delimiter: ",",
  header_line: 1,
  units_line: 2,
  data_start_line: 3,
  columns: [
    { index: 0, name: "Temp", unit: "K", role: "x" },
    { index: 1, name: "Moment", unit: "emu", role: "y" },
  ],
  rows: [[300, 0.0012]],
  n_data_rows: 1,
  n_preview_rows: 1,
};

const DS: DataStruct = {
  time: [300],
  values: [[0.0012]],
  labels: ["Moment"],
  units: ["emu"],
  metadata: {},
};

function pickFile(text = "# header comment\nTemp,Moment\n(K),(emu)\n300,0.0012\n") {
  const file = new File([text], "run1.dat");
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  listImportFiltersMock.mockResolvedValue([]);
  importGuessMock.mockResolvedValue(SETTINGS);
  importPreviewMock.mockResolvedValue(PREVIEW);
  useApp.setState({ datasets: [], activeId: null, status: "", recent: [], importWizardOpen: true });
});

describe("ImportWizardPanel", () => {
  it("prompts to pick a file before anything else", () => {
    render(<ImportWizardPanel />);
    expect(screen.getByText(/Pick a delimited text file/)).toBeInTheDocument();
  });

  it("previews a picked file and shows editable column headers", async () => {
    render(<ImportWizardPanel />);
    pickFile();

    await waitFor(() => expect(screen.getByDisplayValue("Temp")).toBeInTheDocument());
    expect(screen.getByDisplayValue("Moment")).toBeInTheDocument();
    expect(screen.getByDisplayValue("K")).toBeInTheDocument();
    expect(screen.getByText("300")).toBeInTheDocument(); // a resolved data cell
  });

  it("changing a column's role re-previews under the new settings", async () => {
    render(<ImportWizardPanel />);
    pickFile();
    await waitFor(() => expect(screen.getByDisplayValue("Temp")).toBeInTheDocument());
    importPreviewMock.mockClear();

    fireEvent.change(screen.getByLabelText("column 2 role"), { target: { value: "error" } });
    await waitFor(() =>
      expect(importPreviewMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ roles: ["x", "error"] }),
        30,
      ),
    );
  });

  it("imports the previewed file into a new library dataset", async () => {
    importParseMock.mockResolvedValue(DS);
    render(<ImportWizardPanel />);
    pickFile();
    await waitFor(() => expect(screen.getByDisplayValue("Temp")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(1));
    expect(useApp.getState().datasets[0].name).toBe("run1.dat");
    expect(importParseMock).toHaveBeenCalledWith(expect.any(String), SETTINGS);
  });

  it("surfaces a 422 parse error inline", async () => {
    importParseMock.mockRejectedValue(new Error("no y/error columns selected to import"));
    render(<ImportWizardPanel />);
    pickFile();
    await waitFor(() => expect(screen.getByDisplayValue("Temp")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(screen.getByText(/no y\/error columns/)).toBeInTheDocument());
    expect(useApp.getState().datasets).toHaveLength(0);
  });

  it("saves the confirmed settings as a named filter via the param dialog", async () => {
    const saved: ImportFilterWire = { name: "run1", glob: "*.dat", settings: SETTINGS, updated: "t" };
    saveImportFilterMock.mockResolvedValue(saved);
    render(
      <>
        <ImportWizardPanel />
        <ParamDialog />
      </>,
    );
    pickFile();
    await waitFor(() => expect(screen.getByDisplayValue("Temp")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Save as filter…" }));
    await waitFor(() => expect(screen.getByText("Save as filter")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() =>
      expect(saveImportFilterMock).toHaveBeenCalledWith("run1", "*.dat", SETTINGS),
    );
  });

  it("lists saved filters and applies one to re-preview", async () => {
    const filt: ImportFilterWire = { name: "Messy", glob: "*.dat", settings: SETTINGS, updated: "t" };
    listImportFiltersMock.mockResolvedValue([filt]);
    render(<ImportWizardPanel />);
    await waitFor(() => expect(screen.getByText("1 saved")).toBeInTheDocument());
    pickFile();
    await waitFor(() => expect(screen.getByDisplayValue("Temp")).toBeInTheDocument());
    importPreviewMock.mockClear();

    fireEvent.change(screen.getByLabelText("Apply saved filter"), { target: { value: "Messy" } });
    await waitFor(() =>
      expect(importPreviewMock).toHaveBeenCalledWith(expect.any(String), SETTINGS, 30),
    );
  });
});
