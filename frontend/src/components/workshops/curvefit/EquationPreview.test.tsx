// The read-only rendered equation preview (audit P2.7 stretch). KaTeX itself
// is mocked here: these tests pin what the preview asks it to draw and when,
// through the real lazy seam (lib/katexLazy's dynamic import resolves to the
// mock). The load-failure path is EquationPreview.loadFailure.test.tsx.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetTexRendererForTests } from "../../../lib/katexLazy";
import EquationPreview from "./EquationPreview";

// The mock's "markup" is the LaTeX itself, so a test can wait on the DOM.
const drawTex = (tex: string) => `<span class="katex">${tex.replace(/[&<>]/g, "")}</span>`;
const { renderToString } = vi.hoisted(() => ({ renderToString: vi.fn() }));
vi.mock("katex", () => ({ default: { renderToString } }));

beforeEach(() => {
  renderToString.mockReset();
  renderToString.mockImplementation(drawTex);
  resetTexRendererForTests();
});

describe("EquationPreview", () => {
  it("draws the typed equation through KaTeX and redraws as the text changes", async () => {
    const { rerender } = render(<EquationPreview equation="A*exp(-x/tau) + c" suppressed={false} />);
    const first = await screen.findByText("y = A\\,e^{-x/\\tau} + c");
    expect(first).toHaveClass("katex");

    rerender(<EquationPreview equation="A*exp(-x/tau) + c*x" suppressed={false} />);
    expect(await screen.findByText("y = A\\,e^{-x/\\tau} + c\\,x")).toHaveClass("katex");
    expect(screen.queryByText("y = A\\,e^{-x/\\tau} + c")).toBeNull();
    // The preview is a visual copy of the field, not a second editor.
    const box = screen.getByTestId("equation-preview");
    expect(box).toHaveAttribute("aria-hidden", "true");
    expect(box.querySelector("input, textarea, [contenteditable]")).toBeNull();
  });

  it("asks KaTeX for safe output (no trust, errors caught by the seam)", async () => {
    render(<EquationPreview equation="a*x" suppressed={false} />);
    await screen.findByTestId("equation-preview-math");
    expect(renderToString).toHaveBeenCalledWith("y = a\\,x", expect.objectContaining({ trust: false }));
  });

  it("keeps an empty box, and never calls KaTeX, for text it cannot parse", async () => {
    render(<EquationPreview equation="A*exp(" suppressed={false} />);
    const box = screen.getByTestId("equation-preview");
    await new Promise((r) => setTimeout(r, 0));
    expect(box).toBeEmptyDOMElement();
    expect(renderToString).not.toHaveBeenCalled();
  });

  it("goes blank when the text stops parsing and comes back when it parses again", async () => {
    const { rerender } = render(<EquationPreview equation="a*x" suppressed={false} />);
    await screen.findByTestId("equation-preview-math");
    rerender(<EquationPreview equation="a*x +" suppressed={false} />);
    expect(screen.queryByTestId("equation-preview-math")).toBeNull();
    expect(screen.getByTestId("equation-preview")).toBeEmptyDOMElement();
    rerender(<EquationPreview equation="a*x + b" suppressed={false} />);
    expect(await screen.findByTestId("equation-preview-math")).toBeInTheDocument();
  });

  it("draws nothing while the validator rejects the text", async () => {
    const { rerender } = render(<EquationPreview equation="a*x" suppressed={false} />);
    await screen.findByTestId("equation-preview-math");
    rerender(<EquationPreview equation="a*x" suppressed />);
    expect(screen.queryByTestId("equation-preview-math")).toBeNull();
    expect(screen.getByTestId("equation-preview")).toBeInTheDocument();
  });

  it("renders no box at all for an empty equation", () => {
    render(<EquationPreview equation="   " suppressed={false} />);
    expect(screen.queryByTestId("equation-preview")).toBeNull();
  });

  it("draws nothing, and does not throw, when KaTeX refuses the LaTeX", async () => {
    const { rerender } = render(<EquationPreview equation="a*x" suppressed={false} />);
    await screen.findByTestId("equation-preview-math"); // the seam has loaded
    renderToString.mockImplementation(() => {
      throw new Error("KaTeX parse error");
    });
    rerender(<EquationPreview equation="a*x + b" suppressed={false} />);
    expect(renderToString).toHaveBeenLastCalledWith("y = a\\,x + b", expect.anything());
    expect(screen.getByTestId("equation-preview")).toBeEmptyDOMElement();
  });
});
