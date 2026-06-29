import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PlotResultChips from "./PlotResultChips";
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
