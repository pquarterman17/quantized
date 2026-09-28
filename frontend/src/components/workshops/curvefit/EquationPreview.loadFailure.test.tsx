// The equation preview when KaTeX's chunk will not load (audit P2.7 stretch):
// the preview stays empty, nothing throws into React, and the failure is not
// retried within the session (lib/katexLazy explains why). The `katex` factory
// below throws, which is what a failed chunk fetch looks like to
// lib/katexLazy's dynamic import().

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import { loadTexRenderer, resetTexRendererForTests } from "../../../lib/katexLazy";
import EquationPreview from "./EquationPreview";

vi.mock("katex", () => {
  throw new Error("chunk fetch failed");
});

let errorSpy: MockInstance;
beforeEach(() => {
  resetTexRendererForTests();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  // Nothing reached an error boundary or an uncaught-error log.
  expect(errorSpy).not.toHaveBeenCalled();
  errorSpy.mockRestore();
});

describe("EquationPreview when KaTeX fails to load", () => {
  it("stays empty and keeps the rest of the tree mounted", async () => {
    render(
      <>
        <p>the equation field</p>
        <EquationPreview equation="A*exp(-x/tau) + c" suppressed={false} />
      </>,
    );
    // The same cached attempt the preview started: wait for it to settle,
    // then let the preview's rejection handler run.
    await expect(loadTexRenderer()).rejects.toThrow();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByText("the equation field")).toBeInTheDocument();
    expect(screen.getByTestId("equation-preview")).toBeEmptyDOMElement();
  });

  it("does not retry: later callers get the same settled failure", async () => {
    const first = loadTexRenderer();
    await expect(first).rejects.toThrow();
    expect(loadTexRenderer()).toBe(first);
  });
});
