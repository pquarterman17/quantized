// UX menus audit M10: right-clicking a table section opens its menu.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ResultBookSection, { type ResultBookSectionSpec } from "./ResultBookSection";

const spec = (extra: Partial<ResultBookSectionSpec> = {}): ResultBookSectionSpec => ({
  key: "t", kind: "table", title: "Wafer effect", render: () => <table><tbody><tr><td>cell</td></tr></tbody></table>, ...extra,
});

describe("ResultBookSection right-click", () => {
  it("opens the section's menu on a cell and prevents the browser menu", async () => {
    const run = vi.fn();
    render(<ResultBookSection spec={spec({ menu: () => [{ label: "Copy table", run }] })} open onToggle={() => {}} />);
    const notPrevented = fireEvent.contextMenu(screen.getByText("cell"));
    expect(notPrevented).toBe(false);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy table" }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("leaves a section without a menu to the browser", () => {
    render(<ResultBookSection spec={spec()} open onToggle={() => {}} />);
    expect(fireEvent.contextMenu(screen.getByText("cell"))).toBe(true);
  });
});
