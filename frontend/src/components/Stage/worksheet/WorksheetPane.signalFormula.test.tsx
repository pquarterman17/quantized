// The signal functions (savgol, movmax, cummax ...) typed into the worksheet's formula bar and into Set Column Values:
// the REAL entry paths a user takes, checked against scipy / numpy constants (scipy.signal.savgol_filter(a, 5, 2,
// mode="nearest"), np.maximum.accumulate), not against the code under test.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { loadFormulaExtension } from "../../../lib/formulaExt";
import type { ScvTarget } from "../../../lib/setColumnValues";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import SetColumnValuesDialog from "./SetColumnValuesDialog";
import WorksheetPane from "./WorksheetPane";

const Y = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8];
const SG52 = [2.2285714285714273, 2.542857142857142, 1.9428571428571415, 2.714285714285712, 5.342857142857141, 6.171428571428569, 5.2571428571428545, 4.285714285714284, 4.914285714285712, 3.6857142857142833, 5.085714285714283, 7.399999999999997];
// scipy.signal.savgol_filter(Y, 5, 2, mode=...) and a centred 3-row mean (np.mean of Y[r-1:r+2], cut short at the ends).
const SG52_MIRROR = [1.457142857142856, 2.7142857142857135, 1.9428571428571415, 2.714285714285712, 5.342857142857141, 6.171428571428569, 5.2571428571428545, 4.285714285714284, 4.914285714285712, 3.6857142857142833, 5.34285714285714, 6.799999999999997];
const MOVAVG11 = [2, 8 / 3, 2, 10 / 3, 5, 16 / 3, 17 / 3, 13 / 3, 14 / 3, 13 / 3, 16 / 3, 6.5];
const CUMMAX = [3, 3, 4, 4, 5, 9, 9, 9, 9, 9, 9, 9];

const book = (): Dataset => ({ id: "b", name: "Book1", data: { time: Y.map((_, i) => i), values: Y.map((v) => [v]), labels: ["A"], units: ["K"], metadata: {} } });
const st = () => useApp.getState();
const ds = () => st().datasets.find((d) => d.id === "b")!;
const newCol = () => ds().data.values.map((r) => r[1]);
const near = (got: number[], want: number[]) => {
  expect(got).toHaveLength(want.length);
  want.forEach((w, i) => expect(got[i]).toBeCloseTo(w, 9));
};

beforeEach(async () => {
  await loadFormulaExtension();
  useApp.setState({ datasets: [book()], activeId: "b", namedRanges: [], history: [], future: [], status: "" });
});

describe("signal functions through the formula bar", () => {
  it("savgol(A, 5, 2) adds a column equal to scipy's", async () => {
    const user = userEvent.setup();
    render(<WorksheetPane datasetId="b" />);
    await user.type(screen.getByRole("textbox", { name: "Formula" }), "savgol(A, 5, 2)");
    await user.click(screen.getByRole("button", { name: "Add column" }));
    await waitFor(() => expect(ds().formulas?.length).toBe(1));
    expect(ds().formulaErrors ?? {}).toEqual({});
    near(newCol(), SG52);
  });

  it("an even window is recorded as the column's error, with every cell blank", async () => {
    const user = userEvent.setup();
    render(<WorksheetPane datasetId="b" />);
    await user.type(screen.getByRole("textbox", { name: "Formula" }), "savgol(A, 4, 2)");
    await user.click(screen.getByRole("button", { name: "Add column" }));
    await waitFor(() => expect(ds().formulas?.length).toBe(1));
    expect(Object.values(ds().formulaErrors ?? {})).toEqual(["savgol(): window must be odd"]);
    expect(newCol().every(Number.isNaN)).toBe(true);
  });
});

function Host({ target }: { target: ScvTarget }) {
  const d = useApp((s) => s.datasets.find((x) => x.id === "b"))!;
  return <SetColumnValuesDialog ds={d} target={target} xName="X" onClose={() => undefined} />;
}
const formulaBox = () => screen.getByLabelText(/=$/) as HTMLTextAreaElement;

describe("signal functions through Set Column Values", () => {
  it("Add column with cummax(A) matches numpy", async () => {
    const user = userEvent.setup();
    render(<Host target={{ kind: "new" }} />);
    fireEvent.change(formulaBox(), { target: { value: "cummax(A)" } });
    await user.click(await screen.findByRole("button", { name: "Add column" }));
    await waitFor(() => expect(ds().formulas?.length).toBe(1));
    near(newCol(), CUMMAX);
  });

  it("Apply into a data column writes the smoothed values", async () => {
    const user = userEvent.setup();
    render(<Host target={{ kind: "column", col: 0 }} />);
    fireEvent.change(formulaBox(), { target: { value: "savgol(A, 5, 2)" } });
    await user.click(await screen.findByRole("button", { name: "Apply" }));
    await waitFor(() => near(ds().data.values.map((r) => r[0]), SG52));
  });

  it("savgol(A, 5, 2, mirror) takes the boundary mode and matches scipy; an unknown mode is an alert", async () => {
    const user = userEvent.setup();
    render(<Host target={{ kind: "new" }} />);
    fireEvent.change(formulaBox(), { target: { value: "savgol(A, 5, 2, bogus)" } });
    expect(await screen.findByRole("alert")).toHaveTextContent('unknown boundary mode "bogus"; use mirror, nearest, constant, wrap, interp');
    expect(screen.getByRole("button", { name: "Add column" })).toBeDisabled();
    fireEvent.change(formulaBox(), { target: { value: "savgol(A, 5, 2, mirror)" } });
    await user.click(await screen.findByRole("button", { name: "Add column" }));
    await waitFor(() => expect(ds().formulas?.length).toBe(1));
    near(newCol(), SG52_MIRROR);
  });

  it("movavg(A, 1, 1) through the formula bar matches numpy (the same numbers the exported script gives)", async () => {
    const user = userEvent.setup();
    render(<WorksheetPane datasetId="b" />);
    await user.type(screen.getByRole("textbox", { name: "Formula" }), "movavg(A, 1, 1)");
    await user.click(screen.getByRole("button", { name: "Add column" }));
    await waitFor(() => expect(ds().formulas?.length).toBe(1));
    near(newCol(), MOVAVG11);
  });

  it("a bad window is an alert and Add column stays disabled", async () => {
    render(<Host target={{ kind: "new" }} />);
    fireEvent.change(formulaBox(), { target: { value: "savgol(A, 13, 2)" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("window (13) is larger than the column (12 rows)");
    expect(screen.getByRole("button", { name: "Add column" })).toBeDisabled();
  });

  it("the Insert function picker lists savgol, with its edge rule", () => {
    render(<Host target={{ kind: "new" }} />);
    const picker = screen.getByRole("combobox", { name: /insert function/i });
    const options = Array.from((picker as HTMLSelectElement).options).map((o) => o.textContent ?? "");
    expect(options.some((t) => t.startsWith("savgol(A, window, order)") && t.includes("Repeat"))).toBe(true);
  });
});
