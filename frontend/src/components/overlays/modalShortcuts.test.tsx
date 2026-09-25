// R15 — the app's window-level shortcuts while a modal dialog is open.
//
// `inert` (R12) takes the background out of focus and the pointer, but a
// `window` keydown listener hears a key pressed on the dialog's own button, so
// before this Delete inside Preferences removed the active dataset, Ctrl+Z
// undid an edit and `f` opened a workshop behind the dialog. The rule lives in
// ONE place, `lib/appShortcuts.ts`: while a modal is open (or a lazy one is
// pending) only `?` and Ctrl/Cmd+, — which open a dialog ON TOP — reach the
// app's handlers, and keys inside the dialog's own fields are untouched.
//
// Every background case runs TWICE through the real hooks: with no dialog it
// must act (so the "does nothing" half cannot pass on a dead key), and with
// Preferences open and focus on one of its buttons it must not.

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HelpDialog from "./HelpDialog";
import PreferencesDialog from "./PreferencesDialog";
import ShortcutsDialog from "./ShortcutsDialog";
import { usePendingDialogGuard } from "./usePendingDialogGuard";
import { useHistoryCommands } from "../history/useHistoryCommands";
import { useWindowCommands } from "../windows/useWindowCommands";
import { isModalOpen } from "../../lib/appShortcuts";
import { defaultPlotView, type PlotWindow } from "../../lib/plotview";
import { useHelp } from "../../store/help";
import { useToasts } from "../../store/toasts";
import { useApp } from "../../store/useApp";
import { useGlobalShortcuts } from "../../useGlobalShortcuts";

function Keys() {
  useGlobalShortcuts();
  useHistoryCommands();
  useWindowCommands();
  return null;
}
function Shell({ pending = false }: { pending?: boolean }) {
  const help = useHelp((s) => s.open);
  return (
    <div className="qzk-app">
      <Keys />
      {pending && <Pending />}
      <div className="qzk-main">
        <button type="button">background control</button>
      </div>
      <ShortcutsDialog />
      {help && <HelpDialog />}
      <PreferencesDialog />
    </div>
  );
}
const cancelPending = vi.fn();
/** A lazy dialog asked but still loading (bundle-diet slice 8). */
function Pending() {
  usePendingDialogGuard(true, cancelPending);
  return null;
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

const toastText = () => useToasts.getState().toasts.map((t) => t.msg);

function reset(): void {
  useApp.getState().setPrefsOpen(false);
  useApp.getState().setShortcutsOpen(false);
  useHelp.setState({ open: false });
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
    theme: "dark",
    plotWindows: [win("w1"), win("w2")],
    focusedWindowId: "w1",
  });
}
beforeEach(reset);
afterEach(reset);

type Combo = { key: string; ctrl?: boolean; shift?: boolean };
/** One key press on whatever has focus, bubbling to `window` as a real one. */
function press(c: Combo): KeyboardEvent {
  const target = document.activeElement ?? document.body;
  const e = new KeyboardEvent("keydown", {
    key: c.key,
    ctrlKey: !!c.ctrl,
    shiftKey: !!c.shift,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

/** Every class of shortcut that acts on the app BEHIND a dialog. `acted`
 *  reads the one piece of state that shortcut changes. */
const BACKGROUND: { name: string; combo: Combo; acted: () => boolean }[] = [
  { name: "Delete removes the active dataset", combo: { key: "Delete" }, acted: () => useApp.getState().datasets.length < 2 },
  { name: "Backspace removes the active dataset", combo: { key: "Backspace" }, acted: () => useApp.getState().datasets.length < 2 },
  { name: "Ctrl+Z undoes", combo: { key: "z", ctrl: true }, acted: () => toastText().includes("nothing to undo") },
  { name: "Ctrl+Shift+Z redoes", combo: { key: "Z", ctrl: true, shift: true }, acted: () => toastText().includes("nothing to redo") },
  { name: "a tool key (Z) arms a plot tool", combo: { key: "z" }, acted: () => useApp.getState().plotTool !== "pointer" },
  { name: "`f` opens the curve-fit workshop", combo: { key: "f" }, acted: () => useApp.getState().curveFitOpen },
  { name: "`y` opens the hysteresis workshop", combo: { key: "y" }, acted: () => useApp.getState().hysteresisOpen },
  { name: "`p` opens the peaks workshop", combo: { key: "p" }, acted: () => useApp.getState().peaksOpen },
  {
    name: "ArrowDown steps to the next dataset",
    combo: { key: "ArrowDown" },
    acted: () => (useApp.getState().worksheetId ?? useApp.getState().activeId) !== "d1",
  },
  { name: "Ctrl+K opens the command palette", combo: { key: "k", ctrl: true }, acted: () => useApp.getState().cmdkOpen },
  { name: "Ctrl+[ collapses the left panel", combo: { key: "[", ctrl: true }, acted: () => useApp.getState().leftCollapsed },
  { name: "Ctrl+Shift+L toggles the theme", combo: { key: "L", ctrl: true, shift: true }, acted: () => useApp.getState().theme !== "dark" },
  {
    name: "Ctrl+Shift+N opens a new graph window",
    combo: { key: "N", ctrl: true, shift: true },
    acted: () => useApp.getState().plotWindows.length > 2,
  },
  { name: "Ctrl+Tab cycles window focus", combo: { key: "Tab", ctrl: true }, acted: () => useApp.getState().focusedWindowId !== "w1" },
];

async function openPrefs(): Promise<HTMLElement> {
  await act(async () => useApp.getState().setPrefsOpen(true));
  const prefs = screen.getByRole("dialog", { name: /preferences/i });
  act(() => prefs.querySelector<HTMLElement>("button")!.focus());
  return prefs;
}

describe("R15 — background shortcuts do nothing while a modal is open", () => {
  it.each(BACKGROUND)("$name: acts with no dialog open", ({ combo, acted }) => {
    render(<Shell />);
    expect(isModalOpen()).toBe(false);
    act(() => screen.getByRole("button", { name: "background control" }).focus());
    press(combo);
    expect(acted()).toBe(true);
  });

  it.each(BACKGROUND)("$name: does nothing from inside Preferences", async ({ combo, acted }) => {
    render(<Shell />);
    const prefs = await openPrefs();
    expect(isModalOpen()).toBe(true);
    press(combo);
    expect(acted()).toBe(false);
    expect(prefs).toBeInTheDocument();
  });

  it("Ctrl+Z on a Preferences slider (no text of its own to undo) does not undo the app", async () => {
    render(<Shell />);
    const prefs = await openPrefs();
    const plotTab = Array.from(prefs.querySelectorAll(".qzk-prefs-tab")).find((t) => t.textContent === "Plot");
    fireEvent.click(plotTab!);
    const slider = prefs.querySelector<HTMLElement>("input[type='range']");
    expect(slider).not.toBeNull();
    act(() => slider!.focus());
    press({ key: "z", ctrl: true });
    expect(toastText()).toEqual([]);
  });

  it("a lazy dialog still loading (pending guard) counts as open, and releasing it restores the keys", () => {
    const { rerender } = render(<Shell pending />);
    expect(isModalOpen()).toBe(true);
    act(() => screen.getByRole("button", { name: "background control" }).focus());
    press({ key: "Delete" });
    press({ key: "f" });
    expect(useApp.getState().datasets).toHaveLength(2);
    expect(useApp.getState().curveFitOpen).toBe(false);

    rerender(<Shell />);
    expect(isModalOpen()).toBe(false);
    press({ key: "Delete" });
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("closing the dialog gives the keys back", async () => {
    render(<Shell />);
    await openPrefs();
    press({ key: "f" });
    expect(useApp.getState().curveFitOpen).toBe(false);
    await act(async () => useApp.getState().setPrefsOpen(false));
    expect(isModalOpen()).toBe(false);
    press({ key: "f" });
    expect(useApp.getState().curveFitOpen).toBe(true);
  });
});

describe("R15 — the shortcuts that open a dialog ON TOP still work (R16)", () => {
  it("`?` in Preferences opens Shortcuts", async () => {
    render(<Shell />);
    await openPrefs();
    press({ key: "?" });
    expect(useApp.getState().shortcutsOpen).toBe(true);
    expect(screen.getByRole("dialog", { name: /shortcuts/i })).toBeInTheDocument();
  });

  it("Ctrl+, in Help opens Preferences", async () => {
    render(<Shell />);
    await act(async () => useHelp.getState().openHelp());
    const help = screen.getByRole("dialog", { name: "Help" });
    act(() => help.querySelector<HTMLElement>("[role='tab']")!.focus());
    press({ key: ",", ctrl: true });
    expect(useApp.getState().prefsOpen).toBe(true);
    expect(screen.getByRole("dialog", { name: /preferences/i })).toBeInTheDocument();
  });
});

describe("R15 — keys inside a dialog's own text field keep working", () => {
  it("typing shortcut letters, `?`, Backspace and Ctrl+Z in Help's search box edit the field, not the app", async () => {
    const user = userEvent.setup();
    render(<Shell />);
    await act(async () => useHelp.getState().openHelp());
    const search = screen.getByPlaceholderText(/search tools and topics/i);
    await user.click(search);
    await user.keyboard("fz?p");
    expect(search).toHaveValue("fz?p");
    await user.keyboard("{Backspace}");
    expect(search).toHaveValue("fz?");
    // The browser's own field undo needs the keydown left unclaimed.
    const undo = press({ key: "z", ctrl: true });
    expect(undo.defaultPrevented).toBe(false);

    const s = useApp.getState();
    expect(s.datasets).toHaveLength(2);
    expect(s.curveFitOpen).toBe(false);
    expect(s.peaksOpen).toBe(false);
    expect(s.plotTool).toBe("pointer");
    expect(s.shortcutsOpen).toBe(false);
    expect(toastText()).toEqual([]);
  });
});
