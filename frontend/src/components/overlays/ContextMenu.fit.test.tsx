// Chrome audit round 4: the plot's right-click menu is ~640px tall, so in a
// 600px-high window its last rows (Save as PNG/SVG, Help) sat off-screen. A
// too-tall menu now tightens its rows. (It never scrolls: a scrolling root
// would clip its flyouts, and any scroll closes the menu.)
// jsdom has no layout, so the menu's height is stubbed: `full` normally,
// `compact` once the root carries the tightened-rows class.

import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ContextMenu from "./ContextMenu";

function stubMenuHeight(full: number, compact: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const h = this.classList.contains("qzk-ctx") ? (this.classList.contains("fit") ? compact : full) : 0;
    return { x: 0, y: 0, left: 0, top: 0, width: 200, height: h, right: 200, bottom: h, toJSON: () => ({}) } as DOMRect;
  });
}

const open = () => {
  render(<ContextMenu x={100} y={300} onClose={vi.fn()} items={[{ label: "One", run: vi.fn() }]} />);
  return document.body.querySelector(".qzk-ctx") as HTMLElement;
};

describe("ContextMenu fits a short window", () => {
  afterEach(() => vi.restoreAllMocks());

  it("leaves a menu that fits untouched", () => {
    stubMenuHeight(400, 300);
    const root = open();
    expect(root.classList.contains("fit")).toBe(false);
    expect(root.style.top).toBe("300px");
  });

  it("tightens the rows of a too-tall menu and pins it inside the window", () => {
    stubMenuHeight(window.innerHeight + 40, window.innerHeight - 100);
    const root = open();
    expect(root.classList.contains("fit")).toBe(true);
    expect(parseFloat(root.style.top) + window.innerHeight - 100).toBeLessThanOrEqual(window.innerHeight - 8);
  });

  it("detects rows overflowing a max-height-constrained border box", () => {
    // CSS max-height makes getBoundingClientRect() look safe even while the
    // default visible overflow leaves later commands below the viewport.
    stubMenuHeight(window.innerHeight - 16, window.innerHeight - 100);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(window.innerHeight - 16);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(window.innerHeight + 80);
    expect(open()).toHaveClass("fit");
  });
});
