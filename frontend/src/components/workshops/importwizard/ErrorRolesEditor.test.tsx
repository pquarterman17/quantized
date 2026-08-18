import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WizardErrorRow } from "../../../lib/importwizard";
import type { ImportPreviewColumn } from "../../../lib/types";
import ErrorRolesEditor from "./ErrorRolesEditor";

const COLUMNS: ImportPreviewColumn[] = [
  { index: 0, name: "Temp", unit: "K", role: "x" },
  { index: 1, name: "R", unit: "", role: "y" },
  { index: 2, name: "dR", unit: "", role: "error" },
];

describe("ErrorRolesEditor", () => {
  it("renders nothing when there are no error-role rows", () => {
    const { container } = render(
      <ErrorRolesEditor
        rows={[]}
        columns={COLUMNS}
        onTargetChange={vi.fn()}
        onAxisChange={vi.fn()}
        onSideChange={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a suggested target as a real, editable value plus a visible '(suggested)' marker", () => {
    const rows: WizardErrorRow[] = [{ channel: 1, label: "dR", target: 0, axis: "y", side: "both" }];
    render(
      <ErrorRolesEditor rows={rows} columns={COLUMNS} onTargetChange={vi.fn()} onAxisChange={vi.fn()} onSideChange={vi.fn()} />,
    );
    expect(screen.getByLabelText("dR error target")).toHaveValue("0");
    expect(screen.getByText("(suggested)")).toBeInTheDocument();
  });

  it("an unassigned row shows the explicit unassigned option, no suggested marker, and disabled axis/side", () => {
    const rows: WizardErrorRow[] = [{ channel: 1, label: "dR", target: null, axis: "y", side: "both" }];
    render(
      <ErrorRolesEditor rows={rows} columns={COLUMNS} onTargetChange={vi.fn()} onAxisChange={vi.fn()} onSideChange={vi.fn()} />,
    );
    expect(screen.getByLabelText("dR error target")).toHaveValue("unassigned");
    expect(screen.queryByText("(suggested)")).not.toBeInTheDocument();
    expect(screen.getByLabelText("dR error axis")).toBeDisabled();
    expect(screen.getByLabelText("dR error side")).toBeDisabled();
  });

  it("calls onTargetChange with null when the user picks 'unassigned'", () => {
    const rows: WizardErrorRow[] = [{ channel: 1, label: "dR", target: 0, axis: "y", side: "both" }];
    const onTargetChange = vi.fn();
    render(
      <ErrorRolesEditor rows={rows} columns={COLUMNS} onTargetChange={onTargetChange} onAxisChange={vi.fn()} onSideChange={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("dR error target"), { target: { value: "unassigned" } });
    expect(onTargetChange).toHaveBeenCalledWith(1, null);
  });

  it("calls onTargetChange with a channel number when the user picks a real target", () => {
    const rows: WizardErrorRow[] = [{ channel: 1, label: "dR", target: null, axis: "y", side: "both" }];
    const onTargetChange = vi.fn();
    render(
      <ErrorRolesEditor rows={rows} columns={COLUMNS} onTargetChange={onTargetChange} onAxisChange={vi.fn()} onSideChange={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("dR error target"), { target: { value: "0" } });
    expect(onTargetChange).toHaveBeenCalledWith(1, 0);
  });

  it("calls onAxisChange / onSideChange on their pickers", () => {
    const rows: WizardErrorRow[] = [{ channel: 1, label: "dR", target: 0, axis: "y", side: "both" }];
    const onAxisChange = vi.fn();
    const onSideChange = vi.fn();
    render(
      <ErrorRolesEditor rows={rows} columns={COLUMNS} onTargetChange={vi.fn()} onAxisChange={onAxisChange} onSideChange={onSideChange} />,
    );
    fireEvent.change(screen.getByLabelText("dR error axis"), { target: { value: "x" } });
    expect(onAxisChange).toHaveBeenCalledWith(1, "x");
    fireEvent.change(screen.getByLabelText("dR error side"), { target: { value: "+" } });
    expect(onSideChange).toHaveBeenCalledWith(1, "+");
  });

  it("never offers a row's own channel as its own target", () => {
    const rows: WizardErrorRow[] = [{ channel: 1, label: "dR", target: 0, axis: "y", side: "both" }];
    render(
      <ErrorRolesEditor rows={rows} columns={COLUMNS} onTargetChange={vi.fn()} onAxisChange={vi.fn()} onSideChange={vi.fn()} />,
    );
    const select = screen.getByLabelText("dR error target") as HTMLSelectElement;
    const values = [...select.options].map((o) => o.value);
    expect(values).not.toContain("1");
  });
});
