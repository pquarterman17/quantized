import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PreviewStage from "./PreviewStage";
import type { FigureHitmap } from "../../../lib/previewmap";

vi.mock("./PreviewOverlay", () => ({
  default: ({ src }: { src: string }) => <img alt="figure preview" src={src} />,
}));

// An APS single-column figure (8.6 x 6.5 cm) rendered at 200 dpi.
const DPI = 200;
const map = {
  width: Math.round((8.6 / 2.54) * DPI),
  height: Math.round((6.5 / 2.54) * DPI),
  elements: [],
  warnings: [],
} as unknown as FigureHitmap;
const overlay = { textOf: () => "", onSelect: vi.fn(), onEditText: vi.fn(), onDragEnd: vi.fn() };

const renderStage = (over: Partial<Parameters<typeof PreviewStage>[0]> = {}) =>
  render(
    <PreviewStage preview="data:image/png;base64,AA==" hitmap={map} previewDpi={DPI} error={null} busy={false} overlay={overlay} {...over} />,
  );

describe("PreviewStage (UX-H)", () => {
  // 677 x 512 px at 200 dpi: the readout is the RENDER's size, pixel-quantised.
  it("reads the physical size back from the render and shows it", () => {
    renderStage();
    expect(screen.getByLabelText("Figure size")).toHaveTextContent("8.6 × 6.5 cm · 3.38 × 2.56 in");
  });

  it("fits by default and shows true size (96 px/in) at 100 %", () => {
    renderStage();
    const frame = screen.getByTestId("figure-preview-frame");
    expect(frame).toHaveAttribute("data-zoom", "fit");
    expect(frame.style.width).toContain("min(100%");
    fireEvent.click(screen.getByRole("radio", { name: "100 % (screen)" }));
    const trueWidth = (map.width / DPI) * 96 + 18; // + the ruler column
    expect(parseFloat(screen.getByTestId("figure-preview-frame").style.width)).toBeCloseTo(trueWidth, 3);
  });

  it("draws cm rulers along both edges, numbered every cm", () => {
    const { container } = renderStage();
    const x = container.querySelector('[data-ruler="x"]');
    const y = container.querySelector('[data-ruler="y"]');
    expect(x?.textContent).toBe("12345678");
    expect(y?.textContent).toBe("123456");
  });

  it("shows the render error instead of a stale picture", () => {
    renderStage({ error: "preview failed" });
    expect(screen.getByRole("alert")).toHaveTextContent("preview failed");
    expect(screen.queryByAltText("figure preview")).toBeNull();
  });

  it("says it is rendering before the first picture arrives", () => {
    renderStage({ preview: null, hitmap: null, previewDpi: null, busy: true });
    expect(screen.getByText("rendering…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Figure size")).toBeNull();
  });
});
