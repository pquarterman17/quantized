// Floating tool windows resize from every edge and corner (undock-resize lane),
// not just the bottom-right grip: the Data window of the window layout was
// effectively unresizable (one 14 px grip, and a drag past the viewport cap
// stored a size larger than the screen, so the next drags did nothing).

import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import ToolWindow from "./ToolWindow";
import { MIN_HEIGHT, MIN_WIDTH, WINDOW_BOTTOM_GAP } from "../../lib/toolwindow";
import { useApp } from "../../store/useApp";

const set = (l: { x: number; y: number; width: number; height: number | null; collapsed: boolean }) => act(() => useApp.getState().setToolWindowLayout("rz", l));
const layout = () => useApp.getState().toolWindowLayout.rz;

function mount(x = 300, y = 200, width = 400) {
  const { container } = render(
    <ToolWindow id="rz" title="Resizable" x={x} y={y} width={width} onClose={() => {}}>
      body
    </ToolWindow>,
  );
  // jsdom has no pointer capture; the grips call it.
  for (const el of container.querySelectorAll<HTMLElement>("[data-resize-edge]")) {
    el.setPointerCapture = () => undefined;
    el.releasePointerCapture = () => undefined;
  }
  const handle = (edge: string) => container.querySelector<HTMLElement>(`[data-resize-edge="${edge}"]`)!;
  const drag = (edge: string, dx: number, dy: number, from = { x: 500, y: 400 }) => {
    const h = handle(edge);
    fireEvent.pointerDown(h, { clientX: from.x, clientY: from.y, pointerId: 1, button: 0 });
    fireEvent.pointerMove(h, { clientX: from.x + dx, clientY: from.y + dy, pointerId: 1 });
    fireEvent.pointerUp(h, { clientX: from.x + dx, clientY: from.y + dy, pointerId: 1 });
  };
  return { container, handle, drag };
}

beforeEach(() => {
  useApp.setState({ toolWindowLayout: {} });
  window.innerWidth = 1024;
  window.innerHeight = 768;
});

describe("ToolWindow resize handles", () => {
  it("renders the grip and all seven edge and corner handles", () => {
    const { handle } = mount();
    for (const edge of ["n", "e", "s", "w", "ne", "nw", "se", "sw"]) expect(handle(edge)).toBeInTheDocument();
  });

  it("the west and north handles move the origin and keep the opposite edge, and persist", () => {
    const { drag } = mount();
    set({ x: 300, y: 200, width: 400, height: 300, collapsed: false });
    drag("nw", -50, -40);
    expect(layout()).toMatchObject({ x: 250, y: 160, width: 450, height: 340 });
  });

  it("each side resizes only its own axis", () => {
    const { drag } = mount();
    set({ x: 300, y: 200, width: 400, height: 300, collapsed: false });
    drag("e", 30, 99);
    expect(layout()).toMatchObject({ x: 300, y: 200, width: 430, height: 300 });
    drag("s", 99, 25);
    expect(layout()).toMatchObject({ width: 430, height: 325 });
  });

  it("clamps to the minimum size and to the viewport; a drag back from the cap responds at once", () => {
    const { drag } = mount();
    set({ x: 300, y: 200, width: 400, height: 300, collapsed: false });
    drag("se", 5000, 5000);
    expect(layout()).toMatchObject({ width: 1024 - 300, height: 768 - 200 - WINDOW_BOTTOM_GAP });
    drag("se", -60, -60);
    expect(layout()).toMatchObject({ width: 1024 - 300 - 60, height: 768 - 200 - WINDOW_BOTTOM_GAP - 60 });
    drag("se", -5000, -5000);
    expect(layout()).toMatchObject({ width: MIN_WIDTH, height: MIN_HEIGHT });
  });

  it("an auto-height window gets its measured height when first resized from a side", () => {
    const { drag } = mount();
    drag("w", -20, 0);
    expect(layout()?.height).toBeGreaterThanOrEqual(MIN_HEIGHT);
    expect(layout()?.width).toBe(420);
  });

  it("a stored size larger than the viewport is clamped when the window mounts", () => {
    set({ x: 0, y: 0, width: 5000, height: 5000, collapsed: false });
    mount();
    expect(layout()).toMatchObject({ width: 1024, height: 768 - WINDOW_BOTTOM_GAP });
  });

  it("Shift+arrow keyboard resize stops at the room below the window", () => {
    const { container } = mount();
    set({ x: 300, y: 200, width: 400, height: 768 - 200 - WINDOW_BOTTOM_GAP, collapsed: false });
    const bar = container.querySelector<HTMLElement>(".qzk-win-title")!;
    fireEvent.keyDown(bar, { key: "ArrowDown", shiftKey: true });
    expect(layout()?.height).toBe(768 - 200 - WINDOW_BOTTOM_GAP);
    fireEvent.keyDown(bar, { key: "ArrowUp", shiftKey: true });
    expect(layout()?.height).toBeLessThan(768 - 200 - WINDOW_BOTTOM_GAP);
  });
});
