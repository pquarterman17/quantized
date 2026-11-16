// CurveFitResults — readable fit numbers: PDG-rounded value ± SE, 95 % CI,
// units from the column units, dof, five-decimal R², exact-fit / singular
// markers, and one-click copy (TSV for Excel, Markdown).

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CalcResult, Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import CurveFitResults from "./CurveFitResults";

const copyText = vi.fn(async (_t: string) => true);
vi.mock("../../../lib/clipboard", () => ({ copyText: (t: string) => copyText(t) }));

const DS: Dataset = {
  id: "d1",
  name: "run.dat",
  data: { time: [0, 1], values: [[1, 2], [2, 3]], labels: ["T", "M"], units: ["K", "emu"], metadata: {} },
  errorRoles: [],
};
const base: CalcResult = { params: [9, 4.5, 3], errors: [0.0123, 0.2, null], R2: 0.99987, chiSqRed: 1.2, RMSE: 0.05, AIC: -40, nPoints: 12, nFree: 3 };

function view(result: CalcResult) {
  return render(
    <CurveFitResults
      active={DS} modelName="ExpDec1" paramNames={["y0", "A1", "t1"]} result={result}
      fitData={{ x: [1], y: [1], xKey: 0, yKey: 1 }} guessOnly={false} stale={false} xRange={null}
      reporting={false} onReport={() => undefined} cornerBusy={false} onCornerPlot={() => undefined} onRemoveFit={() => undefined}
    />,
  );
}

beforeEach(() => {
  copyText.mockClear();
});

describe("CurveFitResults numbers", () => {
  it("rounds to the error and shows CI, units, dof and R² to five decimals", () => {
    view(base);
    expect(screen.getByText("9.000 ± 0.012")).toBeInTheDocument();
    expect(screen.getByText("[8.972, 9.028]")).toBeInTheDocument();
    expect(screen.getAllByText("emu")).toHaveLength(2); // y0 and A1 are Y-valued; t1 is K
    expect(screen.getByText("0.99987")).toBeInTheDocument();
    expect(screen.getByText("dof")).toBeInTheDocument();
    expect(screen.queryByText(/e-12/)).toBeNull();
  });
  it("says so for an exact fit and for a singular covariance", () => {
    view({ ...base, R2: 1, errors: [8.7e-12, 1e-12, null] });
    expect(screen.getByText("≈1 (exact)")).toBeInTheDocument();
    expect(screen.getByText(/^Exact fit/)).toBeInTheDocument();
    expect(screen.getByText(/Singular covariance: t1/)).toBeInTheDocument();
  });
});

describe("CurveFitResults copy", () => {
  it("one click copies TSV; the Markdown button copies the displayed table", async () => {
    view(base);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy" })); });
    expect(copyText.mock.calls).toHaveLength(1);
    expect(copyText.mock.calls[0]![0]).toContain("y0\t9.000\t0.012\t8.972\t9.028\temu");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy MD" })); });
    expect(copyText.mock.calls).toHaveLength(2);
    expect(copyText.mock.calls[1]![0]).toContain("| y0 | 9.000 ± 0.012 | [8.972, 9.028] | emu |");
    expect(useApp.getState().status).toMatch(/copied the fit results/);
  });
});
