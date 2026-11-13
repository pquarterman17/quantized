// Report-sheet tables leave the app (fitting-workflow audit #6): a table or
// parameter block copies as TSV and saves as CSV, formula-neutralized; a
// text or figure block has no such controls.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { copyText } from "../../../lib/clipboard";
import { saveBlob } from "../../../lib/download";
import { useApp } from "../../../store/useApp";
import { EditableBlock } from "./ReportBlockView";
import { reportBlockTable } from "./reportBlockTable";

vi.mock("../../../lib/clipboard", () => ({ copyText: vi.fn(async () => true) }));
vi.mock("../../../lib/download", () => ({ saveBlob: vi.fn() }));

const ANOVA = {
  type: "table" as const,
  caption: "ANOVA",
  columns: ["Source", "DF", "Sum of Squares"],
  rows: [["Regression", 2, 100], ["=Residual", 8, null]],
};

beforeEach(() => vi.clearAllMocks());

describe("report block copy / CSV", () => {
  it("copies a table block as TSV with formula-like text neutralized", async () => {
    render(<EditableBlock block={ANOVA} blockKey="k" index={0} count={1} onMove={() => {}} onRemove={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: 'Copy "ANOVA" as text' }));
    await waitFor(() => expect(useApp.getState().status).toBe('copied "ANOVA"'));
    expect(vi.mocked(copyText).mock.calls[0]![0]).toBe("ANOVA\nSource\tDF\tSum of Squares\nRegression\t2\t100\n'=Residual\t8\t");
    fireEvent.click(screen.getByRole("button", { name: 'Save "ANOVA" as CSV' }));
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), "ANOVA.csv");
  });

  it("turns a parameter block into a table and leaves text blocks alone", () => {
    expect(reportBlockTable({ type: "params", caption: "Fitted parameters", params: [{ name: "A", value: 2, error: 0.1, unit: "V" }, { name: "B", value: null }] }))
      .toEqual({ title: "Fitted parameters", columns: ["Parameter", "Value", "Error", "Unit"], rows: [["A", 2, 0.1, "V"], ["B", null, null, ""]] });
    expect(reportBlockTable({ type: "text", text: "hi" })).toBeNull();
    render(<EditableBlock block={{ type: "text", text: "hi" }} blockKey="t" index={0} count={1} onMove={() => {}} onRemove={() => {}} />);
    expect(screen.queryByRole("button", { name: /as text/ })).toBeNull();
  });
});
