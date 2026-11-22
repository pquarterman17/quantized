// ModelScanSection on the workbench shell (lane WB4): an out-of-date ranking is
// marked and a row click no longer applies it; refusals and failures are
// distinct alerts.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ScanEntry } from "../../../lib/api/curvefit";
import ModelScanSection from "./ModelScanSection";
import type { ModelScanState } from "./useModelScan";

const ENTRY: ScanEntry = {
  name: "Linear", kind: "registry", error: null, k: 2, params: [1, 0], paramNames: ["m", "b"],
  R2: 0.9, RMSE: 0.5, AIC: 10, AICc: 11, deltaAICc: 0, weight: 1,
};
const state = (over: Partial<ModelScanState>): ModelScanState => ({
  hasDataset: true, results: [ENTRY], busy: false, progress: null, progressMessage: null, error: null,
  refusal: false, stale: false, scan: vi.fn(), cancel: vi.fn(), clear: vi.fn(), ...over,
});

describe("ModelScanSection freshness", () => {
  it("a current ranking applies on a row click", () => {
    const onApply = vi.fn();
    render(<ModelScanSection state={state({})} onApply={onApply} />);
    expect(screen.queryByText(/Out of date/)).toBeNull();
    fireEvent.click(screen.getByText("Linear"));
    expect(onApply).toHaveBeenCalledWith("registry", "Linear");
  });

  it("an out-of-date ranking says so and does not apply", () => {
    const onApply = vi.fn();
    render(<ModelScanSection state={state({ stale: true })} onApply={onApply} />);
    expect(screen.getByText(/Out of date/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Linear"));
    expect(onApply).not.toHaveBeenCalled();
  });

  it("a refusal and a failed job are different alerts", () => {
    const { rerender } = render(<ModelScanSection state={state({ error: "no finite X/Y pairs", refusal: true })} onApply={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveAttribute("data-kind", "refusal");
    rerender(<ModelScanSection state={state({ error: "backend down" })} onApply={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveAttribute("data-kind", "error");
  });
});
