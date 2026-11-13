// Audit #5: the Publication preview's Canvas group sizes the figure through
// the SAME PageSetup Page setup and the Export dialog edit; a legacy preview's
// request carries that page exactly as the Stage export does.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FigureSpec } from "../../../lib/api/figures";
import type { PageSetup } from "../../../lib/pagesetup";
import CanvasPanel from "./CanvasPanel";
import { withPageSetup } from "./canonicalPage";

const PAGE: PageSetup = { width: 8.5, height: 6, unit: "cm", margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5 }, aspectDerived: false };

describe("CanvasPanel page size", () => {
  it("typing a width with no page yet creates one from the 6 x 4 in default", () => {
    const setPageSetup = vi.fn();
    render(<CanvasPanel overrides={{}} patch={vi.fn()} pageSetup={null} setPageSetup={setPageSetup} />);
    expect(screen.getByText("No page set: the style preset's size.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("page width"), { target: { value: "5" } });
    expect(setPageSetup).toHaveBeenLastCalledWith(expect.objectContaining({ width: 5, height: 4, unit: "in", aspectDerived: false }));
  });

  it("a unit change keeps the same physical page", () => {
    const setPageSetup = vi.fn();
    render(<CanvasPanel overrides={{}} patch={vi.fn()} pageSetup={PAGE} setPageSetup={setPageSetup} />);
    expect(screen.getByLabelText("page width")).toHaveValue("8.5");
    fireEvent.change(screen.getByLabelText("page unit"), { target: { value: "mm" } });
    const next = setPageSetup.mock.calls[0][0] as PageSetup;
    expect(next.unit).toBe("mm");
    expect(next.width).toBeCloseTo(85, 9);
    expect(next.margins.left).toBeCloseTo(5, 9);
  });

  it("axes-box margins still patch the subplot-fraction override", () => {
    const patch = vi.fn();
    render(<CanvasPanel overrides={{}} patch={patch} />);
    expect(screen.queryByLabelText("page width")).toBeNull();
    fireEvent.change(screen.getByLabelText("left"), { target: { value: "0.2" } });
    expect(patch).toHaveBeenLastCalledWith({ margins: { left: 0.2 } });
  });
});

describe("withPageSetup (legacy preview request)", () => {
  it("sizes the request and pads the page, as the Stage export does", () => {
    const spec = { fmt: "png", overrides: { grid: true } } as unknown as FigureSpec;
    const out = withPageSetup(PAGE, spec);
    expect(out.width_in).toBeCloseTo(8.5 / 2.54, 12);
    expect(out.height_in).toBeCloseTo(6 / 2.54, 12);
    expect(out.overrides).toEqual({ grid: true, page_pad: { left: 0.5 / 8.5, right: 0.5 / 8.5, top: 0.5 / 6, bottom: 0.5 / 6 } });
    expect(withPageSetup(null, spec)).toBe(spec);
  });
});
