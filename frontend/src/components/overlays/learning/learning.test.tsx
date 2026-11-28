// The learning aids through their real entry points: the Help commands from the
// real registry, the lazy host, the dialogs' own buttons, and the Preferences
// switch.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildAppActions } from "../../../appCommands";
import { workflowPrefsSlot } from "../../../lib/workflowPrefs";
import { TIPS } from "../../../lib/learning/tips";
import { useHintLog } from "../../../store/hintLog";
import { useLearningDialogs } from "../../../store/learningDialogs";
import { toast, useToasts } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import PrefsGeneralPane from "../PrefsGeneralPane";
import LearningHost, { resetStartupTipForTests } from "./LearningHost";

const command = (id: string) => buildAppActions(useApp.getState).find((a) => a.id === id)!;

beforeEach(() => {
  localStorage.clear();
  useApp.setState(useApp.getInitialState(), true);
  useLearningDialogs.setState({ open: null });
  useHintLog.getState().clear();
  useToasts.setState({ toasts: [] });
  resetStartupTipForTests();
});
afterEach(cleanup);

describe("Recent hints", () => {
  it("is a Help command that lists a toast with its action, and Clear empties it", () => {
    render(<LearningHost />);
    act(() => toast("Imported 2 files", "ok", { action: { label: "Undo", onClick: () => {} } }));
    act(() => command("recent-hints").run());
    expect(screen.getByRole("dialog", { name: "Recent hints" })).toBeTruthy();
    expect(screen.getByText(/Imported 2 files/)).toBeTruthy();
    expect(screen.getByText(/offered: Undo/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText(/Nothing yet/)).toBeTruthy();
  });

  it("Esc closes it", () => {
    render(<LearningHost />);
    act(() => command("recent-hints").run());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useLearningDialogs.getState().open).toBeNull();
  });
});

describe("Sample gallery", () => {
  it("lists every sample, and Open adds the worksheet and closes the gallery", async () => {
    render(<LearningHost />);
    act(() => command("sample-gallery").run());
    expect(screen.getAllByRole("button", { name: /^Open / })).toHaveLength(6);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Open Decay with error bars" })));
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["sample-decay.dat"]);
    expect(useLearningDialogs.getState().open).toBeNull();
  });
});

describe("Tip of the day", () => {
  it("opens from Help with Next and Previous, and stays off at start by default", () => {
    render(<LearningHost />);
    expect(screen.queryByRole("dialog")).toBeNull(); // fail closed: no popup on start
    act(() => command("tip-of-the-day").run());
    expect(screen.getByText(TIPS[0]!.title)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(TIPS[1]!.title)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText(TIPS[TIPS.length - 1]!.title)).toBeTruthy();
    expect(screen.getByText(new RegExp(TIPS[TIPS.length - 1]!.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeTruthy();
  });

  it("Show at start turns the startup tip on, and the next launch shows a tip", () => {
    render(<LearningHost />);
    act(() => command("tip-of-the-day").run());
    fireEvent.click(screen.getByRole("switch", { name: "Show at start" }));
    expect(workflowPrefsSlot.load().showTipAtStart).toBe(true);
    cleanup();
    useLearningDialogs.setState({ open: null });
    resetStartupTipForTests();
    render(<LearningHost />);
    expect(screen.getByRole("dialog", { name: "Tip of the day" })).toBeTruthy();
  });

  it("Preferences > General has the same switch", () => {
    render(<PrefsGeneralPane />);
    const sw = screen.getByRole("switch", { name: "Show a tip at start" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    expect(workflowPrefsSlot.load().showTipAtStart).toBe(true);
  });
});
