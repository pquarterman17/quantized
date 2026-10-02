// Plain-key app shortcuts (no Ctrl/Cmd/Alt) must not act while focus is in a
// tool window. A workshop is a non-modal dialog: with focus on one of its
// buttons, Delete used to remove the active dataset and `f`/`y`/`p`/the
// arrows acted on the app behind it. Modifier shortcuts are unchanged.
//
// Every case runs twice through the real hooks: from a Stage control it must
// act (so the "does nothing" half cannot pass on a dead key), and from a
// button inside a ToolWindow the plain keys must not.

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import ToolWindow from "./ToolWindow";
import { useHistoryCommands } from "../history/useHistoryCommands";
import { useWindowCommands } from "../windows/useWindowCommands";
import { defaultPlotView, type PlotWindow } from "../../lib/plotview";
import { useToasts } from "../../store/toasts";
import { useApp } from "../../store/useApp";
import { useGlobalShortcuts } from "../../useGlobalShortcuts";

function Keys() {
  useGlobalShortcuts();
  useHistoryCommands();
  useWindowCommands();
  return null;
}
function Shell() {
  return (
    <div className="qzk-app">
      <Keys />
      <div className="qzk-stage">
        <button type="button">stage control</button>
      </div>
      <ToolWindow id="peaks" title="Find peaks" onClose={() => {}}>
        <button type="button">Run</button>
      </ToolWindow>
    </div>
  );
}

const ds = (id: string) => ({
  id,
  name: `${id}.dat`,
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
});
const win = (id: string): PlotWindow => ({
  id,
  kind: "plot",
  title: "",
  datasetId: "d1",
  geometry: { x: 0, y: 0, w: 480, h: 360 },
  z: 0,
  winState: "normal",
  view: defaultPlotView(),
  bg: "theme",
  linkGroup: null,
  pinned: false,
});

function reset(): void {
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [ds("d1"), ds("d2")],
    activeId: "d1",
    worksheetId: null,
    selectedIds: [],
    confirmRemove: false,
    history: [],
    future: [],
    plotTool: "pointer",
    curveFitOpen: false,
    hysteresisOpen: false,
    peaksOpen: false,
    cmdkOpen: false,
    leftCollapsed: false,
    plotWindows: [win("w1"), win("w2")],
    focusedWindowId: "w1",
  });
}
beforeEach(reset);
afterEach(reset);

type Combo = { key: string; ctrl?: boolean; shift?: boolean };
function press(c: Combo): void {
  const target = document.activeElement ?? document.body;
  const e = new KeyboardEvent("keydown", { key: c.key, ctrlKey: !!c.ctrl, shiftKey: !!c.shift, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(e);
  });
}

const PLAIN: { name: string; combo: Combo; acted: () => boolean }[] = [
  { name: "Delete removes the active dataset", combo: { key: "Delete" }, acted: () => useApp.getState().datasets.length < 2 },
  { name: "Backspace removes the active dataset", combo: { key: "Backspace" }, acted: () => useApp.getState().datasets.length < 2 },
  { name: "a tool key (Z) arms a plot tool", combo: { key: "z" }, acted: () => useApp.getState().plotTool !== "pointer" },
  { name: "`f` opens the curve-fit workshop", combo: { key: "f" }, acted: () => useApp.getState().curveFitOpen },
  { name: "`y` opens the hysteresis workshop", combo: { key: "y" }, acted: () => useApp.getState().hysteresisOpen },
  { name: "`p` opens the peaks workshop", combo: { key: "p" }, acted: () => useApp.getState().peaksOpen },
  {
    name: "ArrowDown steps to the next dataset",
    combo: { key: "ArrowDown" },
    acted: () => (useApp.getState().worksheetId ?? useApp.getState().activeId) !== "d1",
  },
];

const MODIFIER: { name: string; combo: Combo; acted: () => boolean }[] = [
  { name: "Ctrl+K opens the command palette", combo: { key: "k", ctrl: true }, acted: () => useApp.getState().cmdkOpen },
  { name: "Ctrl+[ collapses the left panel", combo: { key: "[", ctrl: true }, acted: () => useApp.getState().leftCollapsed },
  { name: "Ctrl+Z undoes", combo: { key: "z", ctrl: true }, acted: () => useToasts.getState().toasts.some((t) => t.msg.includes("nothing to undo")) },
  {
    name: "Ctrl+Shift+N opens a new graph window",
    combo: { key: "N", ctrl: true, shift: true },
    acted: () => useApp.getState().plotWindows.length > 2,
  },
];

const focusStage = () => act(() => screen.getByRole("button", { name: "stage control" }).focus());
const focusWindow = () => act(() => screen.getByRole("button", { name: "Run" }).focus());

describe("plain-key shortcuts and tool windows", () => {
  it.each(PLAIN)("$name: acts from the Stage", ({ combo, acted }) => {
    render(<Shell />);
    focusStage();
    press(combo);
    expect(acted()).toBe(true);
  });

  it.each(PLAIN)("$name: does nothing from inside a tool window", ({ combo, acted }) => {
    render(<Shell />);
    focusWindow();
    press(combo);
    expect(acted()).toBe(false);
  });

  it.each(MODIFIER)("$name: still acts from inside a tool window", ({ combo, acted }) => {
    render(<Shell />);
    focusWindow();
    press(combo);
    expect(acted()).toBe(true);
  });
});
