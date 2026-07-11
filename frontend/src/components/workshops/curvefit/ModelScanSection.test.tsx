// ModelScanSection (GOTO #6): ranked table rendering, row-click apply
// (registry vs saved-equation routing), failed-candidate display, and the
// scan/clear affordances. Pure view — state arrives as a prop, so specs
// fabricate ModelScanState directly.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ScanEntry } from "../../../lib/api";
import ModelScanSection from "./ModelScanSection";
import type { ModelScanState } from "./useModelScan";

function entry(over: Partial<ScanEntry>): ScanEntry {
  return {
    name: "Linear",
    kind: "registry",
    error: null,
    k: 2,
    params: [1, 0],
    paramNames: ["m", "b"],
    R2: 0.9,
    RMSE: 0.5,
    AIC: 10,
    AICc: 11,
    deltaAICc: 5,
    weight: 0.1,
    ...over,
  };
}

function state(over: Partial<ModelScanState>): ModelScanState {
  return {
    hasDataset: true,
    results: null,
    busy: false,
    error: null,
    scan: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn(),
    ...over,
  };
}

describe("ModelScanSection", () => {
  it("renders the ranked table with k/AICc/delta/weight/R2 columns", () => {
    const results = [
      entry({ name: "Gaussian", k: 3, AICc: -120.5, deltaAICc: 0, weight: 0.98, R2: 0.999 }),
      entry({ name: "Linear", AICc: -20.1, deltaAICc: 100.4, weight: 0.001, R2: 0.4 }),
    ];
    render(<ModelScanSection state={state({ results })} onApply={vi.fn()} />);
    expect(screen.getByText("Gaussian")).toBeInTheDocument();
    expect(screen.getByText("Linear")).toBeInTheDocument();
    for (const col of ["model", "k", "AICc", "Δ", "w", "R²"]) {
      expect(screen.getByText(col)).toBeInTheDocument();
    }
    // Gaussian's row shows its stats (fmtNum default formatting).
    const row = screen.getByText("Gaussian").closest("tr")!;
    expect(row.textContent).toContain("3");
    expect(row.textContent).toContain("0.98");
  });

  it("clicking a row applies the model (registry kind + name)", () => {
    const onApply = vi.fn();
    render(
      <ModelScanSection
        state={state({ results: [entry({ name: "Gaussian" })] })}
        onApply={onApply}
      />,
    );
    fireEvent.click(screen.getByText("Gaussian"));
    expect(onApply).toHaveBeenCalledWith("registry", "Gaussian");
  });

  it("an equation candidate is labeled with the saved-model glyph and routes its kind", () => {
    const onApply = vi.fn();
    render(
      <ModelScanSection
        state={state({ results: [entry({ name: "MyDecay", kind: "equation" })] })}
        onApply={onApply}
      />,
    );
    fireEvent.click(screen.getByText("ƒ MyDecay"));
    expect(onApply).toHaveBeenCalledWith("equation", "MyDecay");
  });

  it("a failed candidate shows its error and does not apply on click", () => {
    const onApply = vi.fn();
    const failed = entry({
      name: "bad",
      kind: "equation",
      error: "Mismatched parentheses.",
      k: null,
      AICc: null,
      deltaAICc: null,
      weight: null,
      R2: null,
    });
    render(<ModelScanSection state={state({ results: [failed] })} onApply={onApply} />);
    expect(screen.getByText("Mismatched parentheses.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("ƒ bad"));
    expect(onApply).not.toHaveBeenCalled();
  });

  it("Scan models triggers the scan and disables without a dataset", () => {
    const s = state({ hasDataset: true });
    const { rerender } = render(<ModelScanSection state={s} onApply={vi.fn()} />);
    fireEvent.click(screen.getByText("Scan models"));
    expect(s.scan).toHaveBeenCalledOnce();

    rerender(<ModelScanSection state={state({ hasDataset: false })} onApply={vi.fn()} />);
    expect(screen.getByText("Scan models")).toBeDisabled();
  });

  it("Clear appears with results and calls clear; busy shows Scanning…", () => {
    const s = state({ results: [entry({})] });
    render(<ModelScanSection state={s} onApply={vi.fn()} />);
    fireEvent.click(screen.getByText("Clear"));
    expect(s.clear).toHaveBeenCalledOnce();

    render(<ModelScanSection state={state({ busy: true })} onApply={vi.fn()} />);
    expect(screen.getByText("Scanning…")).toBeDisabled();
  });

  it("surfaces a scan error", () => {
    render(
      <ModelScanSection state={state({ error: "scan failed" })} onApply={vi.fn()} />,
    );
    expect(screen.getByText("scan failed")).toBeInTheDocument();
  });
});
