import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ImportPreviewResponse } from "../../../lib/types";
import PreviewTable from "./PreviewTable";

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

describe("PreviewTable", () => {
  it("renders every raw line numbered, and the resolved column headers + data row", () => {
    render(
      <PreviewTable preview={PREVIEW} onRoleChange={vi.fn()} onNameChange={vi.fn()} onUnitChange={vi.fn()} />,
    );
    for (const line of PREVIEW.raw_lines) expect(screen.getByText(line)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Temp")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Moment")).toBeInTheDocument();
    expect(screen.getByDisplayValue("K")).toBeInTheDocument();
    expect(screen.getByDisplayValue("emu")).toBeInTheDocument();
    expect(screen.getByText("300")).toBeInTheDocument();
    expect(screen.getByText(/1 data row/)).toBeInTheDocument();
  });

  it("highlights the header and units rows distinctly", () => {
    render(
      <PreviewTable preview={PREVIEW} onRoleChange={vi.fn()} onNameChange={vi.fn()} onUnitChange={vi.fn()} />,
    );
    const header = screen.getByText("Temp,Moment").closest("div")!;
    const units = screen.getByText("(K),(emu)").closest("div")!;
    expect(header.getAttribute("style")).toContain("background");
    expect(units.getAttribute("style")).toContain("background");
    expect(header.getAttribute("style")).not.toBe(units.getAttribute("style"));
  });

  it("calls back with the column index on name / unit / role edits", () => {
    const onNameChange = vi.fn();
    const onUnitChange = vi.fn();
    const onRoleChange = vi.fn();
    render(
      <PreviewTable
        preview={PREVIEW}
        onRoleChange={onRoleChange}
        onNameChange={onNameChange}
        onUnitChange={onUnitChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("column 1 name"), { target: { value: "Temperature" } });
    expect(onNameChange).toHaveBeenCalledWith(0, "Temperature");

    fireEvent.change(screen.getByLabelText("column 1 unit"), { target: { value: "C" } });
    expect(onUnitChange).toHaveBeenCalledWith(0, "C");

    fireEvent.change(screen.getByLabelText("column 2 role"), { target: { value: "error" } });
    expect(onRoleChange).toHaveBeenCalledWith(1, "error");
  });
});
