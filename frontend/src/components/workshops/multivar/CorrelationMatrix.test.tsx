import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import CorrelationMatrix from "./CorrelationMatrix";

describe("CorrelationMatrix", () => {
  it("renders undefined constant-variable correlations as a dash, not zero", () => {
    render(<CorrelationMatrix labels={["signal", "constant"]} corr={{
      r: [[1, null], [null, null]], p: [[1, null], [null, null]], N: 4, method: "pearson",
    }} />);

    const cell = screen.getByTitle("constant × signal: r=—, p=—");
    expect(cell).toHaveTextContent("—");
    expect(cell).not.toHaveTextContent("0");
  });
});
