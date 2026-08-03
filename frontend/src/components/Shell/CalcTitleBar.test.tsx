// CalcTitleBar (extracted from CalcOnlyApp, standalone-DiraCulator audit
// 2026-08-02): the "open full app" escape hatch (item 4) and the connection
// dot (item 9), tested in isolation rather than through the whole
// CalcOnlyApp render.

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CalcTitleBar from "./CalcTitleBar";
import { useConnection } from "../../lib/lifecycle";

beforeEach(() => {
  useConnection.setState({ connected: true });
  window.history.pushState({}, "", "/?view=calc");
});

afterEach(() => {
  window.history.pushState({}, "", "/");
});

describe("CalcTitleBar — open full app (item 4)", () => {
  it('the "↗" button opens the app origin+path WITHOUT ?view=calc', () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<CalcTitleBar />);
    fireEvent.click(screen.getByRole("button", { name: "Open the full Quantized app" }));
    expect(openSpy).toHaveBeenCalledWith(
      `${window.location.origin}${window.location.pathname}`,
      "_blank",
    );
    // The URL handed to window.open must not carry the ?view=calc query.
    expect(openSpy.mock.calls[0][0]).not.toContain("view=calc");
    openSpy.mockRestore();
  });
});

describe("CalcTitleBar — connection dot (item 9)", () => {
  it("shows a connected (ok) dot when the connection is up", () => {
    useConnection.setState({ connected: true });
    const { container } = render(<CalcTitleBar />);
    expect(container.querySelector(".qz-dot.qz-ok")).toBeInTheDocument();
    expect(container.querySelector(".qz-dot.qz-warn")).not.toBeInTheDocument();
  });

  it("shows an offline (warn) dot when the connection is down", () => {
    useConnection.setState({ connected: false });
    const { container } = render(<CalcTitleBar />);
    expect(container.querySelector(".qz-dot.qz-warn")).toBeInTheDocument();
    expect(container.querySelector(".qz-dot.qz-ok")).not.toBeInTheDocument();
  });
});
