// Residual R3 (P3.3): a floating workshop window could be moved and resized
// only by pointer drag. Its title bar is now a Tab stop: the arrow keys move
// the window and Shift + the arrow keys resize it, in KEY_STEP px steps,
// clamped exactly as a drag end is.

import { renderHook, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import ToolWindow from "./ToolWindow";
import { KEY_STEP, MIN_HEIGHT, MIN_WIDTH } from "../../lib/toolwindow";
import { useApp } from "../../store/useApp";
import { useGlobalShortcuts } from "../../useGlobalShortcuts";
import type { Dataset } from "../../lib/types";

function renderPanel(x = 120, y = 90, width = 360) {
  render(
    <ToolWindow id="kbd" title="Find peaks" x={x} y={y} width={width} onClose={() => {}}>
      <button type="button">Run</button>
    </ToolWindow>,
  );
  return screen.getByRole("group", { name: "Find peaks title bar" });
}

const layout = () => useApp.getState().toolWindowLayout.kbd;

beforeEach(() => {
  useApp.setState({ toolWindowLayout: {} });
});

describe("ToolWindow keyboard move and resize (R3)", () => {
  it("the title bar is reachable with Tab from the frame", async () => {
    const user = userEvent.setup();
    const bar = renderPanel();
    // The frame takes focus on open; the title bar is the next Tab stop.
    await user.tab();
    expect(bar).toHaveFocus();
  });

  it("the arrow keys move the window one step per press", async () => {
    const user = userEvent.setup();
    renderPanel().focus();

    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowDown}");

    expect(layout()).toMatchObject({ x: 120 + 2 * KEY_STEP, y: 90 + KEY_STEP, width: 360 });
    expect(document.querySelector<HTMLElement>(".qzk-win")?.style.left).toBe(`${120 + 2 * KEY_STEP}px`);
  });

  it("a move is clamped to the viewport, like a drag end", async () => {
    const user = userEvent.setup();
    renderPanel(0, 0).focus();

    await user.keyboard("{ArrowLeft}{ArrowUp}");

    expect(layout()).toMatchObject({ x: 0, y: 0 });
  });

  it("Shift + the arrow keys resize the window, never below the minimum", async () => {
    const user = userEvent.setup();
    renderPanel(120, 90, MIN_WIDTH + KEY_STEP).focus();

    await user.keyboard("{Shift>}{ArrowLeft}{ArrowLeft}{ArrowDown}{/Shift}");

    expect(layout()).toMatchObject({ x: 120, y: 90, width: MIN_WIDTH });
    expect(layout()?.height).toBeGreaterThanOrEqual(MIN_HEIGHT);
  });

  it("an arrow key on a title-bar button leaves the window where it is", async () => {
    const user = userEvent.setup();
    renderPanel();
    screen.getByRole("button", { name: "Close Find peaks" }).focus();

    await user.keyboard("{ArrowRight}");

    expect(layout()).toBeUndefined();
  });

  it("the title bar's arrow keys do not also step the active dataset", async () => {
    const user = userEvent.setup();
    const ds = (id: string): Dataset =>
      ({ id, name: id, data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} } }) as unknown as Dataset;
    useApp.setState({ datasets: [ds("a"), ds("b")], activeId: "a", worksheetId: null });
    renderHook(() => useGlobalShortcuts());
    renderPanel().focus();

    await user.keyboard("{ArrowDown}");

    expect(layout()).toMatchObject({ y: 90 + KEY_STEP });
    expect(useApp.getState().activeId).toBe("a");
  });
});
