import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PlotResultChips from "./PlotResultChips";
import type { GadgetChipState } from "./useGadgetChip";
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

function fakeGadget(over: Partial<GadgetChipState> = {}): GadgetChipState {
  return {
    mode: "fit",
    modes: ["fit", "integrate", "stats", "differentiate", "fft", "cursors"],
    setMode: vi.fn(),
    roi: null,
    cursors: null,
    model: "Linear",
    models: ["Linear", "Gaussian", "Exponential Decay"],
    setModel: vi.fn(),
    fitResult: null,
    integrateResult: null,
    statsResult: null,
    derivResult: null,
    fftPreview: null,
    cursorResult: null,
    busy: false,
    error: null,
    reporting: false,
    commit: vi.fn(),
    report: vi.fn().mockResolvedValue(undefined),
    dismiss: vi.fn(),
    ...over,
  };
}

describe("PlotResultChips — gadget chip, fit mode (#33)", () => {
  it("renders nothing extra when gadget is absent or has no armed roi/cursors/result", () => {
    const { container } = render(
      <PlotResultChips integral={null} fwhm={null} onClearIntegral={vi.fn()} onClearFwhm={vi.fn()} />,
    );
    expect(container.querySelector(".qzk-gadget-chip")).toBeNull();
    const { container: c2 } = render(
      <PlotResultChips
        integral={null}
        fwhm={null}
        onClearIntegral={vi.fn()}
        onClearFwhm={vi.fn()}
        gadget={fakeGadget()}
      />,
    );
    expect(c2.querySelector(".qzk-gadget-chip")).toBeNull();
  });

  it("shows the mode + model pickers + params/R² and commits on click", () => {
    const commit = vi.fn();
    const gadget = fakeGadget({
      roi: [1, 3],
      fitResult: { params: [2, 0], errors: [0.1, 0.2], R2: 0.98 },
      commit,
    });
    const { getByText, container } = render(
      <PlotResultChips integral={null} fwhm={null} onClearIntegral={vi.fn()} onClearFwhm={vi.fn()} gadget={gadget} />,
    );
    expect(container.querySelector(".qzk-gadget-chip")).not.toBeNull();
    expect(container.textContent).toContain("p0=2");
    expect(container.textContent).toContain("R²");
    fireEvent.click(getByText("Commit"));
    expect(commit).toHaveBeenCalledOnce();
  });

  it("shows a busy state and disables the actions while computing", () => {
    const gadget = fakeGadget({ roi: [1, 3], busy: true });
    const { getByText, container } = render(
      <PlotResultChips integral={null} fwhm={null} onClearIntegral={vi.fn()} onClearFwhm={vi.fn()} gadget={gadget} />,
    );
    expect(container.textContent).toContain("computing…");
    expect(getByText("Commit")).toBeDisabled();
  });

  it("shows an error message from a failed compute", () => {
    const gadget = fakeGadget({ roi: [1, 3], error: "not enough points in the selected region" });
    const { container } = render(
      <PlotResultChips integral={null} fwhm={null} onClearIntegral={vi.fn()} onClearFwhm={vi.fn()} gadget={gadget} />,
    );
    expect(container.textContent).toContain("not enough points");
  });

  it("switches the model via the select and dismisses via ×", () => {
    const setModel = vi.fn();
    const dismiss = vi.fn();
    const gadget = fakeGadget({ roi: [1, 3], fitResult: { params: [1], R2: 0.5 }, setModel, dismiss });
    const { container, getAllByTitle } = render(
      <PlotResultChips integral={null} fwhm={null} onClearIntegral={vi.fn()} onClearFwhm={vi.fn()} gadget={gadget} />,
    );
    const selects = container.querySelectorAll(".qzk-gadget-chip select");
    fireEvent.change(selects[1], { target: { value: "Gaussian" } }); // [0] = mode picker, [1] = model picker
    expect(setModel).toHaveBeenCalledWith("Gaussian");
    fireEvent.click(getAllByTitle("Clear").at(-1)!);
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("switches gadget mode via the mode select", () => {
    const setMode = vi.fn();
    const gadget = fakeGadget({ roi: [1, 3], setMode });
    const { container } = render(
      <PlotResultChips integral={null} fwhm={null} onClearIntegral={vi.fn()} onClearFwhm={vi.fn()} gadget={gadget} />,
    );
    const selects = container.querySelectorAll(".qzk-gadget-chip select");
    fireEvent.change(selects[0], { target: { value: "integrate" } });
    expect(setMode).toHaveBeenCalledWith("integrate");
  });

  it("emits a report on click", () => {
    const report = vi.fn().mockResolvedValue(undefined);
    const gadget = fakeGadget({ roi: [1, 3], fitResult: { params: [1], R2: 0.5 }, report });
    const { getByText } = render(
      <PlotResultChips integral={null} fwhm={null} onClearIntegral={vi.fn()} onClearFwhm={vi.fn()} gadget={gadget} />,
    );
    fireEvent.click(getByText("→ Report"));
    expect(report).toHaveBeenCalledOnce();
  });
});

describe("PlotResultChips — ROI gadget family, other modes (#34)", () => {
  it("integrate mode shows area/centroid/FWHM and a Report button but no Commit", () => {
    const gadget = fakeGadget({
      mode: "integrate",
      roi: [1, 3],
      integrateResult: {
        peaks: [{ region: [1, 3], area: 5, area_pct: 100, centroid: 2, height: 4, position: 2, fwhm: 1 }],
        total_area: 5,
        baseline: "linear",
      },
    });
    const { container, queryByText, getByText } = render(
      <PlotResultChips integral={null} fwhm={null} onClearIntegral={vi.fn()} onClearFwhm={vi.fn()} gadget={gadget} />,
    );
    expect(container.textContent).toContain("area");
    expect(container.textContent).toContain("centroid");
    expect(queryByText("Commit")).toBeNull();
    expect(getByText("→ Report")).toBeInTheDocument();
  });

  it("stats mode shows N/mean/sd/min/max", () => {
    const gadget = fakeGadget({
      mode: "stats",
      roi: [1, 3],
      statsResult: { N: 10, mean: 5, std: 1.2, min: 2, max: 8 },
    });
    const { container } = render(
      <PlotResultChips integral={null} fwhm={null} onClearIntegral={vi.fn()} onClearFwhm={vi.fn()} gadget={gadget} />,
    );
    expect(container.textContent).toContain("N");
    expect(container.textContent).toContain("10");
    expect(container.textContent).toContain("mean");
    expect(container.textContent).toContain("sd");
  });

  it("differentiate mode shows the extremum and has neither Commit nor Report", () => {
    const gadget = fakeGadget({
      mode: "differentiate",
      roi: [1, 3],
      derivResult: { dydx: [1, 2, 3], extremumX: 2, extremumDydx: 3 },
    });
    const { container, queryByText } = render(
      <PlotResultChips integral={null} fwhm={null} onClearIntegral={vi.fn()} onClearFwhm={vi.fn()} gadget={gadget} />,
    );
    expect(container.textContent).toContain("extremum");
    expect(queryByText("Commit")).toBeNull();
    expect(queryByText("→ Report")).toBeNull();
  });

  it("fft mode shows N/window and a '→ Spectrum' commit button, no Report", () => {
    const commit = vi.fn();
    const gadget = fakeGadget({
      mode: "fft",
      roi: [1, 3],
      fftPreview: { freq: [0, 1, 2, 3], magnitude: [0, 1, 2, 1], df: 1, nfft: 4, fs: 4, windowName: "hanning" },
      commit,
    });
    const { container, getByText, queryByText } = render(
      <PlotResultChips integral={null} fwhm={null} onClearIntegral={vi.fn()} onClearFwhm={vi.fn()} gadget={gadget} />,
    );
    expect(container.textContent).toContain("hanning");
    expect(queryByText("→ Report")).toBeNull();
    fireEvent.click(getByText("→ Spectrum"));
    expect(commit).toHaveBeenCalledOnce();
  });

  it("cursors mode shows the Δx/Δy/slope readout via formatMeasurement, no Commit/Report", () => {
    const gadget = fakeGadget({
      mode: "cursors",
      cursors: [1, 3],
      cursorResult: { x0: 1, y0: 10, x1: 3, y1: 30, dx: 2, dy: 20, slope: 10 },
    });
    const { container, queryByText } = render(
      <PlotResultChips integral={null} fwhm={null} onClearIntegral={vi.fn()} onClearFwhm={vi.fn()} gadget={gadget} />,
    );
    expect(container.textContent).toContain("Δx");
    expect(container.textContent).toContain("slope");
    expect(queryByText("Commit")).toBeNull();
    expect(queryByText("→ Report")).toBeNull();
  });

  it("shows the chip when only cursors are armed (no roi)", () => {
    const gadget = fakeGadget({ mode: "cursors", roi: null, cursors: [1, 3] });
    const { container } = render(
      <PlotResultChips integral={null} fwhm={null} onClearIntegral={vi.fn()} onClearFwhm={vi.fn()} gadget={gadget} />,
    );
    expect(container.querySelector(".qzk-gadget-chip")).not.toBeNull();
  });
});
