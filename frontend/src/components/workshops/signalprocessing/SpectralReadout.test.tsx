import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import SpectralReadout from "./SpectralReadout";

function result(metadata: DataStruct["metadata"]): DataStruct {
  return { time: [0, 1], values: [[0], [1]], labels: ["result"], units: [""], metadata };
}

describe("SpectralReadout", () => {
  it("renders a filter transfer-function diagnostic", () => {
    render(<SpectralReadout result={result({
      filterDiagnostics: { frequency: [0, 1, 2], transfer: [1, 0.5, 0] },
    })} />);
    expect(screen.getByRole("img", { name: "Filter transfer function preview" })).toBeInTheDocument();
  });

  it("renders the correlation peak in source-axis units", () => {
    render(<SpectralReadout result={result({
      peakLag: 0.025,
      peakCorrelation: -0.875,
      x_column_unit: "s",
    })} />);
    const readout = screen.getByLabelText("Cross-correlation peak");
    expect(readout).toHaveTextContent("0.025 s");
    expect(readout).toHaveTextContent("-0.875");
  });
});
