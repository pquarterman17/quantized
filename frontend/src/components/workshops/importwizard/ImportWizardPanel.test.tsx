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

// All six moved to lib/api/importFilters.ts (R8 bundle-diet pass) — mock
// them at their real import path.
vi.mock("../../../lib/api/importFilters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/importFilters")>()),
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
  label_line: null,
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
  label_line: null,
  data_start_line: 3,
  columns: [
    { index: 0, name: "Temp", unit: "K", role: "x" },
    { index: 1, name: "Moment", unit: "emu", role: "y" },
  ],
  rows: [[300, 0.0012]],
  n_data_rows: 1,
  n_preview_rows: 1,
  comments: [],
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

  it("P1-5 DEFECT 1: disables Import and shows a named-column conflict message when two columns are marked x", async () => {
    importPreviewMock.mockResolvedValue({
      ...PREVIEW,
      columns: [
        { index: 0, name: "Temp", unit: "K", role: "x" },
        { index: 1, name: "Moment", unit: "emu", role: "x" },
      ],
    });
    render(<ImportWizardPanel />);
    pickFile();
    await waitFor(() => expect(screen.getByDisplayValue("Temp")).toBeInTheDocument());

    const importButton = screen.getByRole("button", { name: "Import" });
    expect(importButton).toBeDisabled();
    expect(screen.getAllByText(/only one column can be x/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Temp/).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/column \d role/).length).toBeGreaterThan(0);
    // Both offending role selects are marked invalid.
    expect(screen.getByLabelText("column 1 role")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("column 2 role")).toHaveAttribute("aria-invalid", "true");
  });

  it("P1-5 DEFECT 1: re-enables Import once the conflict is resolved back to a single x column", async () => {
    importPreviewMock.mockResolvedValue({
      ...PREVIEW,
      columns: [
        { index: 0, name: "Temp", unit: "K", role: "x" },
        { index: 1, name: "Moment", unit: "emu", role: "x" },
      ],
    });
    render(<ImportWizardPanel />);
    pickFile();
    await waitFor(() => expect(screen.getByDisplayValue("Temp")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();

    importPreviewMock.mockResolvedValue(PREVIEW); // back to a single x column
    fireEvent.change(screen.getByLabelText("column 2 role"), { target: { value: "y" } });

    await waitFor(() => expect(screen.getByRole("button", { name: "Import" })).not.toBeDisabled());
    expect(screen.queryByText(/only one column can be x/)).not.toBeInTheDocument();
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

  it("Cancel closes the wizard, leaving zero state behind on reopen (P1.6 item 5)", async () => {
    render(<ImportWizardPanel />);
    pickFile();
    await waitFor(() => expect(screen.getByDisplayValue("Temp")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useApp.getState().importWizardOpen).toBe(false);

    // Reopen: ImportWizardPanel only mounts while importWizardOpen (AppOverlays.tsx),
    // so a fresh render starts from nothing — no leftover file/preview.
    useApp.setState({ importWizardOpen: true });
    render(<ImportWizardPanel />);
    expect(screen.getByText(/Pick a delimited text file/)).toBeInTheDocument();
  });

  it("shows the retained preamble as searchable metadata, not silently dropped (P1.6 item 3)", async () => {
    importPreviewMock.mockResolvedValue({ ...PREVIEW, comments: ["# Sample: NbAu bilayer"] });
    render(<ImportWizardPanel />);
    pickFile();
    await waitFor(() => expect(screen.getByDisplayValue("Temp")).toBeInTheDocument());
    expect(screen.getByText(/Sample: NbAu bilayer/)).toBeInTheDocument();
  });

  it("shows an editable label-line field that carries into the preview highlight", async () => {
    render(<ImportWizardPanel />);
    pickFile();
    await waitFor(() => expect(screen.getByDisplayValue("Temp")).toBeInTheDocument());
    // label_line 0 -- a raw line with no OTHER role in this fixture, so its
    // highlight is attributable ONLY to the label-line edit below.
    importPreviewMock.mockResolvedValue({ ...PREVIEW, label_line: 0 });

    const field = screen.getByLabelText(/Label line/) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "0" } });
    expect(field).toHaveValue("0");

    // Wait on the OBSERVABLE state the edit produces (the highlighted label
    // row once the re-preview lands), not on the mock call itself.
    await waitFor(() =>
      expect(screen.getByText("# header comment").closest("div")!.getAttribute("style")).toContain("background"),
    );
  });

  it("shows the error-role editor once a column is marked 'error', with the auto-suggestion pre-filled (P1.6 item 2)", async () => {
    importPreviewMock.mockResolvedValue({
      ...PREVIEW,
      columns: [
        { index: 0, name: "Temp", unit: "K", role: "x" },
        { index: 1, name: "Moment", unit: "emu", role: "y" },
        { index: 2, name: "dMoment", unit: "emu", role: "error" },
      ],
    });
    render(<ImportWizardPanel />);
    pickFile();
    await waitFor(() => expect(screen.getByDisplayValue("Temp")).toBeInTheDocument());

    // The error-role row seeds via an effect one tick after columns land —
    // wait on its OWN presence (state), not a mock call.
    await waitFor(() => expect(screen.getByLabelText("dMoment error target")).toBeInTheDocument());
    expect(screen.getByLabelText("dMoment error target")).toHaveValue("0"); // "dMoment" -> "Moment", channel 0
    expect(screen.getByText("(suggested)")).toBeInTheDocument();
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
