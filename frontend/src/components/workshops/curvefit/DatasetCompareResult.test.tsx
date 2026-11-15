import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DatasetCompareResult as Comparison } from "../../../lib/api/globalFit";
import DatasetCompareResult from "./DatasetCompareResult";

const BASE: Comparison = {
  test: { F: 12.5, dfNum: 2, dfDen: 10, p: 0.002 },
  shared: { rss: 30, n: 14, nParams: 2, df: 12, aic: 1, aicc: 2, bic: 3 },
  separate: { rss: 10, n: 14, nParams: 4, df: 10, aic: 0, aicc: 1, bic: 2 },
  sharedParams: ["m"],
  conclusion: "separate",
  paramNames: ["m", "b"],
};

describe("DatasetCompareResult", () => {
  it("renders nothing without a comparison", () => {
    const { container } = render(<DatasetCompareResult comparison={null} compareAll />);
    expect(container).toBeEmptyDOMElement();
  });

  it("states the rejection, the F(dfNum, dfDen) and both models' dof", () => {
    render(<DatasetCompareResult comparison={BASE} compareAll={false} />);
    expect(screen.getByText(/Reject one shared value of m/)).toBeInTheDocument();
    expect(screen.getByText(/F\(2, 10\)/)).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Dataset comparison table" })).toBeInTheDocument();
  });

  it("states adequacy and names 'all parameters' when none was ticked", () => {
    render(
      <DatasetCompareResult comparison={{ ...BASE, conclusion: "shared", test: { ...BASE.test, p: 0.6 } }} compareAll />,
    );
    expect(screen.getByText(/One shared value of all parameters is adequate/)).toBeInTheDocument();
  });
});
