// The Text to columns dialog: the preview follows the delimiter, an unusable
// delimiter disables Create with a reason, Create commits a new worksheet.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import TextToColumnsDialog from "./TextToColumnsDialog";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));

const sheet: Dataset = {
  id: "w",
  name: "scan",
  data: { time: [1, 2], values: [[1], [2]], labels: ["M"], units: [""], metadata: { origin_text_columns: { Cond: ["300,a", "310,b"] } } },
};

beforeEach(() => {
  useApp.setState({ datasets: [{ ...sheet }], activeId: "w", history: [], future: [], status: "", analysisResults: [], staleDatasets: [] });
});

describe("TextToColumnsDialog", () => {
  it("previews the split and updates when the delimiter changes", () => {
    render(<TextToColumnsDialog ds={sheet} textName="Cond" onClose={() => {}} />);
    expect(screen.getByText(/2 columns \(1 numeric\)/)).toBeTruthy();
    expect(screen.getByText("300")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Delimiter"), { target: { value: "semicolon" } });
    expect(screen.getByText(/1 column \(0 numeric\)/)).toBeTruthy();
    expect(screen.getByText("300,a")).toBeTruthy();
  });

  it("a custom delimiter needs a string: Create is disabled with the reason until one is typed", () => {
    render(<TextToColumnsDialog ds={sheet} textName="Cond" onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Delimiter"), { target: { value: "custom" } });
    expect(screen.getByRole("alert").textContent).toContain("type the delimiter");
    expect((screen.getByRole("button", { name: "Create worksheet" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Custom delimiter"), { target: { value: "," } });
    expect((screen.getByRole("button", { name: "Create worksheet" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("Create adds the worksheet and closes", async () => {
    const onClose = vi.fn();
    render(<TextToColumnsDialog ds={sheet} textName="Cond" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Create worksheet" }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    await waitFor(() => expect(onClose.mock.calls.length).toBe(1));
    expect(useApp.getState().datasets[0].data.labels).toEqual(["M"]);
  });
});
