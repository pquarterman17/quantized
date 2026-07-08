import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PlotResultChips from "./PlotResultChips";
import type { QuickFitChipState } from "./useQuickFitChip";
import type { FwhmResult } from "../../lib/peakwidth";

const fwhm: FwhmResult = {
  center: 12.5,
  height: 100,
  baseline: 2,
  half: 51,
  x1: 11,
  x2: 14,
  fwhm: 3,
};

describe("PlotResultChips", () => {
  it("renders nothing when both results are null", () => {
    const { container } = render(
      <PlotResultChips integral={null} fwhm={null} onClearIntegral={vi.fn()} onClearFwhm={vi.fn()} />,
    );
    expect(container.querySelector(".qzk-result-chips")).toBeNull();
  });

  it("shows an integral chip with the ∫ glyph and clears on ×", () => {
    const onClear = vi.fn();
    const { container, getByTitle } = render(
      <PlotResultChips
        integral={{ xlo: 0, xhi: 4, area: 8 }}
        fwhm={null}
        onClearIntegral={onClear}
        onClearFwhm={vi.fn()}
      />,
    );
    const chip = container.querySelector(".qzk-result-chip");
    expect(chip?.textContent).toContain("∫");
    fireEvent.click(getByTitle("Clear"));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("shows a peak/FWHM chip and stacks both when present", () => {
    const { container } = render(
      <PlotResultChips
        integral={{ xlo: 0, xhi: 4, area: 8 }}
        fwhm={fwhm}
        onClearIntegral={vi.fn()}
        onClearFwhm={vi.fn()}
      />,
    );
    const chips = container.querySelectorAll(".qzk-result-chip");
    expect(chips.length).toBe(2);
    expect(container.textContent).toContain("∩");
    expect(container.textContent).toContain("FWHM");
  });
});

function fakeQfit(over: Partial<QuickFitChipState> = {}): QuickFitChipState {
  return {
    roi: null,
    model: "Linear",
    models: ["Linear", "Gaussian", "Exponential Decay"],
    busy: false,
    error: null,
    result: null,
    reporting: false,
    setModel: vi.fn(),
    commit: vi.fn(),
    report: vi.fn().mockResolvedValue(undefined),
    dismiss: vi.fn(),
    ...over,
  };
}

describe("PlotResultChips — quick-fit gadget (#33)", () => {
  it("renders nothing extra when qfit is absent or has no armed roi/result", () => {
    const { container } = render(
      <PlotResultChips integral={null} fwhm={null} onClearIntegral={vi.fn()} onClearFwhm={vi.fn()} />,
    );
    expect(container.querySelector(".qzk-qfit-chip")).toBeNull();
    const { container: c2 } = render(
      <PlotResultChips
        integral={null}
        fwhm={null}
        onClearIntegral={vi.fn()}
        onClearFwhm={vi.fn()}
        qfit={fakeQfit()}
      />,
    );
    expect(c2.querySelector(".qzk-qfit-chip")).toBeNull();
  });

  it("shows the model picker + params/R² and commits on click", () => {
    const commit = vi.fn();
    const qfit = fakeQfit({
      roi: [1, 3],
      result: { params: [2, 0], errors: [0.1, 0.2], R2: 0.98 },
      commit,
    });
    const { getByText, container } = render(
      <PlotResultChips integral={null} fwhm={null} onClearIntegral={vi.fn()} onClearFwhm={vi.fn()} qfit={qfit} />,
    );
    expect(container.querySelector(".qzk-qfit-chip")).not.toBeNull();
    expect(container.textContent).toContain("p0=2");
    expect(container.textContent).toContain("R²");
    fireEvent.click(getByText("Commit"));
    expect(commit).toHaveBeenCalledOnce();
  });

  it("shows a busy state and disables the actions while fitting", () => {
    const qfit = fakeQfit({ roi: [1, 3], busy: true });
    const { getByText, container } = render(
      <PlotResultChips integral={null} fwhm={null} onClearIntegral={vi.fn()} onClearFwhm={vi.fn()} qfit={qfit} />,
    );
    expect(container.textContent).toContain("fitting…");
    expect(getByText("Commit")).toBeDisabled();
  });

  it("shows an error message from a failed fit", () => {
    const qfit = fakeQfit({ roi: [1, 3], error: "not enough points in the selected region" });
    const { container } = render(
      <PlotResultChips integral={null} fwhm={null} onClearIntegral={vi.fn()} onClearFwhm={vi.fn()} qfit={qfit} />,
    );
    expect(container.textContent).toContain("not enough points");
  });

  it("switches the model via the select and dismisses via ×", () => {
    const setModel = vi.fn();
    const dismiss = vi.fn();
    const qfit = fakeQfit({ roi: [1, 3], result: { params: [1], R2: 0.5 }, setModel, dismiss });
    const { container, getAllByTitle } = render(
      <PlotResultChips integral={null} fwhm={null} onClearIntegral={vi.fn()} onClearFwhm={vi.fn()} qfit={qfit} />,
    );
    const select = container.querySelector(".qzk-qfit-chip select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "Gaussian" } });
    expect(setModel).toHaveBeenCalledWith("Gaussian");
    fireEvent.click(getAllByTitle("Clear").at(-1)!);
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("emits a report on click", () => {
    const report = vi.fn().mockResolvedValue(undefined);
    const qfit = fakeQfit({ roi: [1, 3], result: { params: [1], R2: 0.5 }, report });
    const { getByText } = render(
      <PlotResultChips integral={null} fwhm={null} onClearIntegral={vi.fn()} onClearFwhm={vi.fn()} qfit={qfit} />,
    );
    fireEvent.click(getByText("→ Report"));
    expect(report).toHaveBeenCalledOnce();
  });
});
