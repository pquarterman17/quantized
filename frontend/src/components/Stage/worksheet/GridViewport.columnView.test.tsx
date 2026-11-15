// GridViewport with hidden and frozen columns (gap audit 5, item 8). The claims
// are structural, never a clock: hidden columns are not drawn but the rest keep
// their TRUE column numbers (screen readers), a frozen prefix is sticky at
// stacked offsets and stays rendered however far the grid scrolls sideways, and
// the windowed column count follows the viewport — never the hidden or frozen
// count — so 80+ column instrument files cost no more than a narrow one.

import { readFileSync } from "node:fs";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_COL_WIDTH, DEFAULT_GUTTER_WIDTH } from "../../../lib/gridwindow";
import type { DataStruct } from "../../../lib/types";
import GridViewport from "./GridViewport";

const noop = () => {};

function wide(nCols: number, nRows = 3): DataStruct {
  return {
    time: Array.from({ length: nRows }, (_, i) => i),
    values: Array.from({ length: nRows }, (_, r) => Array.from({ length: nCols }, (_, c) => r * 1000 + c)),
    labels: Array.from({ length: nCols }, (_, c) => `C${c}`),
    units: Array(nCols).fill(""),
    metadata: {},
  };
}

function renderGrid(nCols: number, extra: Partial<React.ComponentProps<typeof GridViewport>> = {}) {
  const data = wide(nCols);
  const utils = render(
    <GridViewport
      data={data}
      xName="x"
      xUnit=""
      order={data.time.map((_, i) => i)}
      masked={new Set()}
      filteredOut={new Set()}
      selected={new Set()}
      channelRoles={{}}
      sortMark={() => ""}
      selectedCols={new Set()}
      onToggleColSelect={noop}
      onSelectColRange={noop}
      onToggleSelect={noop}
      onSelectRange={noop}
      onEditCell={noop}
      baseCount={nCols}
      onRemoveFormula={noop}
      showStats={false}
      colStats={null}
      statsErr={false}
      textCols={[]}
      {...extra}
    />,
  );
  const scrollEl = utils.container.querySelector(".qzk-grid") as HTMLElement;
  return { ...utils, scrollEl };
}

function measureAs(el: HTMLElement, width: number, height: number) {
  Object.defineProperty(el, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: height });
  fireEvent(window, new Event("resize"));
}

const headers = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[role="columnheader"][data-col]'));
const cols = (c: HTMLElement) => headers(c).map((h) => Number(h.dataset.col));

describe("hidden columns", () => {
  it("are not drawn (header or cells); the others keep their true column numbers", () => {
    const { container } = renderGrid(5, { hiddenCols: new Set([1, 2]) });
    expect(cols(container)).toEqual([-1, 0, 3, 4]);
    expect(screen.queryByText("C1")).toBeNull();
    // aria-colindex: gutter 1, X 2, value column c is c + 3 — a hidden column leaves a gap, not a renumbering.
    expect(headers(container).map((h) => h.getAttribute("aria-colindex"))).toEqual(["2", "3", "6", "7"]);
    expect(container.querySelector(".qzk-grid")?.getAttribute("aria-colcount")).toBe("7");
    const firstRowCells = container.querySelectorAll('[role="row"]:nth-child(2) [role="gridcell"]');
    expect(firstRowCells).toHaveLength(4); // x + 3 shown value columns
  });

  it("without any hidden column no aria-colindex is added (unchanged markup)", () => {
    const { container } = renderGrid(3);
    expect(container.querySelector("[aria-colindex]")).toBeNull();
    expect(container.querySelector(".qzk-grid")?.hasAttribute("aria-colcount")).toBe(false);
  });

  it("the header says columns are hidden, names them, and shows the run on click", () => {
    const onShowCols = vi.fn();
    renderGrid(5, { hiddenCols: new Set([1, 2, 4]), onShowCols });
    const afterA = screen.getByRole("button", { name: /2 hidden columns after C0: C1, C2/ });
    const afterD = screen.getByRole("button", { name: /1 hidden column after C3: C4/ });
    expect(afterD).toBeTruthy();
    fireEvent.click(afterA);
    expect(onShowCols).toHaveBeenCalledWith([1, 2]);
  });

  it("columns hidden right after X are announced on the X header", () => {
    renderGrid(3, { hiddenCols: new Set([0]) });
    expect(screen.getByRole("button", { name: /1 hidden column after x: C0/ })).toBeTruthy();
  });
});

describe("frozen columns", () => {
  const W = DEFAULT_COL_WIDTH;
  const G = DEFAULT_GUTTER_WIDTH;

  it("are sticky at stacked offsets after the gutter and X, in the header and every row", () => {
    const { container } = renderGrid(6, { frozenCols: 2, hiddenCols: new Set([0]) });
    // Column 0 is hidden, so the prefix pins column 1 only.
    const pinned = headers(container).filter((h) => h.style.position === "sticky" && Number(h.dataset.col) >= 0);
    expect(pinned.map((h) => [Number(h.dataset.col), h.style.left])).toEqual([[1, `${G + W}px`]]);
    const { container: c2 } = renderGrid(6, { frozenCols: 3 });
    const p2 = headers(c2).filter((h) => h.style.position === "sticky" && Number(h.dataset.col) >= 0);
    expect(p2.map((h) => h.style.left)).toEqual([`${G + W}px`, `${G + 2 * W}px`, `${G + 3 * W}px`]);
    const row = c2.querySelector('[role="row"]:nth-child(2)') as HTMLElement;
    const stickyCells = Array.from(row.querySelectorAll<HTMLElement>('[role="gridcell"]')).filter((x) => x.style.position === "sticky");
    expect(stickyCells).toHaveLength(4); // X + 3 frozen
  });

  it("stay rendered, once each, however far the rest scrolls sideways", () => {
    const { container, scrollEl } = renderGrid(100, { frozenCols: 2 });
    measureAs(scrollEl, 600, 400);
    scrollEl.scrollLeft = 60 * W;
    fireEvent.scroll(scrollEl);
    const now = cols(container);
    expect(now.slice(0, 3)).toEqual([-1, 0, 1]); // X, then the pinned pair
    expect(new Set(now).size).toBe(now.length);
    expect(now.some((c) => c >= 55)).toBe(true); // the window followed the scroll
    expect(now).not.toContain(2); // an unpinned early column has scrolled away
  });
});

describe("windowing cost follows the viewport, not the hidden or frozen count (no clock)", () => {
  const rendered = (nCols: number, extra: Partial<React.ComponentProps<typeof GridViewport>>, scrollCols = 0) => {
    const { container, scrollEl } = renderGrid(nCols, extra);
    measureAs(scrollEl, 800, 400);
    if (scrollCols) {
      scrollEl.scrollLeft = scrollCols * DEFAULT_COL_WIDTH;
      fireEvent.scroll(scrollEl);
    }
    return cols(container).length;
  };

  it("hiding 190 of 200 columns draws the 10 left, and hiding none stays bounded by the viewport", () => {
    const hidden = new Set(Array.from({ length: 190 }, (_, i) => i + 5));
    expect(rendered(200, { hiddenCols: hidden })).toBe(1 + 10); // X + the 10 shown
    const plain = rendered(200, {});
    expect(plain).toBeLessThan(20); // ~800/120 + overscan, not 200
  });

  it("hidden columns in the way do not enlarge the window: 150 of 200 hidden costs the same as none", () => {
    const hidden = new Set(Array.from({ length: 150 }, (_, i) => i * 1 + 20)); // 20..169
    const none = rendered(200, {}, 40);
    const some = rendered(200, { hiddenCols: hidden }, 40);
    expect(some).toBeLessThanOrEqual(none);
    expect(some).toBeGreaterThan(1);
  });

  it("freezing many columns renders them plus a viewport-sized window — never the whole sheet", () => {
    const n = rendered(200, { frozenCols: 5 }, 90);
    expect(n).toBeLessThanOrEqual(1 + 5 + 14); // X + pinned + window
    expect(n).toBeGreaterThan(1 + 5);
  });

  it("scrolling re-windows only the unpinned, shown columns", () => {
    const { container, scrollEl } = renderGrid(200, { frozenCols: 3, hiddenCols: new Set([10, 11, 12]) });
    measureAs(scrollEl, 800, 400);
    const first = cols(container).filter((c) => c >= 3);
    expect(first[0]).toBe(3); // the scrolling run starts right after the prefix
    expect(first).not.toContain(10);
    scrollEl.scrollLeft = 5 * DEFAULT_COL_WIDTH;
    fireEvent.scroll(scrollEl);
    const after = cols(container).filter((c) => c >= 3);
    expect(after).not.toContain(10);
    expect(after).not.toContain(11);
    expect(after).toContain(13); // scrolled past the hidden gap with no empty hole
  });
});

describe("pinned cells stay pinned across the whole horizontal scroll", () => {
  // jsdom lays nothing out, so this reads the rule itself. A flex row is only as wide as the
  // viewport; a sticky cell is confined to its row, so without `min-width: max-content` the
  // gutter, X and every frozen column scrolled away once scrollLeft passed one viewport width
  // (seen live on a 90-column sheet).
  it("the grid row is at least as wide as its cells", () => {
    const css = readFileSync("src/styles/shell.css", "utf8");
    const rule = css.split("\n").find((l) => l.startsWith(".qzk-grid-row {"));
    expect(rule).toMatch(/min-width:\s*max-content/);
  });
});
