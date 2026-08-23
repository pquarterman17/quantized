// Calc-only shell (MAIN_PLAN #22): must render the calculators content and
// a minimal header, and must NOT mount the full app shell (Library / Stage /
// Inspector / menubar). Extended for the 2026-08-02 standalone-DiraCulator
// audit: ConfirmDialog now mounts here too (item 1), plus document.title
// (item 5), the Ctrl/Cmd+Shift+L theme shortcut (item 6), and the
// back-gesture guard (item 7).

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getConstants } from "./lib/api/reference";
import CalcOnlyApp from "./CalcOnlyApp";
import { useCalcHistory } from "./store/calcHistory";
import { useApp } from "./store/useApp";

vi.mock("./lib/api/reference", () => ({
  getConstants: vi.fn(),
  // useCalculators also fetches the units-converter category table from
  // this sibling export — a partial mock must cover it too (R8 merged it
  // into the same file as getConstants), or the call throws instead of the
  // original real-fetch-rejects-and-is-caught behavior.
  getUnitCategories: vi.fn().mockRejectedValue(new Error("offline")),
}));

beforeEach(() => {
  vi.mocked(getConstants).mockResolvedValue({ constants: {}, systems: { SI: [], CGS: [], eV: [] } });
  useCalcHistory.setState({ history: [], favorites: [] });
});

describe("CalcOnlyApp", () => {
  it("renders a DiraCulator header and the calculators tab selector", () => {
    render(<CalcOnlyApp />);
    expect(screen.getByText("DiraCulator")).toBeInTheDocument();
    expect(screen.getByLabelText("calculator")).toBeInTheDocument();
  });

  it("does not mount the full app shell (Library/Stage/Inspector/menubar)", () => {
    render(<CalcOnlyApp />);
    // App.tsx's Library+Stage+Inspector row and the menubar are qzk-main /
    // qzk-menubar; CalcOnlyApp never imports those components, so neither
    // class can appear in the DOM.
    expect(document.querySelector(".qzk-main")).toBeNull();
    expect(document.querySelector(".qzk-menubar")).toBeNull();
  });

  // item 5 — document.title
  it("sets document.title to DiraCulator", () => {
    document.title = "something else";
    render(<CalcOnlyApp />);
    expect(document.title).toBe("DiraCulator");
  });

  // item 6 — Ctrl/Cmd+Shift+L keyboard parity with useGlobalShortcuts
  it("Ctrl+Shift+L toggles the theme", () => {
    useApp.setState({ theme: "dark" });
    render(<CalcOnlyApp />);
    fireEvent.keyDown(window, { key: "l", ctrlKey: true, shiftKey: true });
    expect(useApp.getState().theme).toBe("light");
    fireEvent.keyDown(window, { key: "l", ctrlKey: true, shiftKey: true });
    expect(useApp.getState().theme).toBe("dark");
  });

  it("plain 'l' (no modifiers) does not toggle the theme", () => {
    useApp.setState({ theme: "dark" });
    render(<CalcOnlyApp />);
    fireEvent.keyDown(window, { key: "l" });
    expect(useApp.getState().theme).toBe("dark");
  });

  // item 7 — back-gesture guard (App.tsx:44-49, ported here; App.tsx's own
  // sentinel has no test of its own — the App tree is too heavy to render in
  // jsdom (see AppOverlays.tsx) — so this is the first test of the pattern).
  it("re-asserts the URL on a back/forward gesture (back-gesture guard)", () => {
    const pushSpy = vi.spyOn(window.history, "pushState");
    render(<CalcOnlyApp />);
    expect(pushSpy).toHaveBeenCalledWith(null, "", location.href);
    pushSpy.mockClear();
    fireEvent(window, new PopStateEvent("popstate"));
    expect(pushSpy).toHaveBeenCalledWith(null, "", location.href);
    pushSpy.mockRestore();
  });

  // item 1 — Clear History was dead in the standalone shell: HistoryTab's
  // askConfirm() call needs a live <ConfirmDialog/> to resolve against, and
  // CalcOnlyApp used to mount only the calculators content + Toaster.
  // Deliberately NOT mocking ConfirmDialog here — the point is the real one.
  it("mounts a real ConfirmDialog so Clear History actually clears (item 1)", async () => {
    useCalcHistory.setState({
      history: [
        { id: "a", domain: "Optics", label: "calc a", summary: "n = 1.5", ts: "2026-07-19T00:00:00.000Z" },
        { id: "b", domain: "Optics", label: "calc b", summary: "n = 1.5", ts: "2026-07-19T00:00:00.000Z" },
      ],
      favorites: [],
    });
    render(<CalcOnlyApp />);
    fireEvent.change(screen.getByLabelText("calculator"), { target: { value: "history" } });
    fireEvent.click(screen.getByText("Clear history"));

    const dialogTitle = await screen.findByText("Clear 2 calculator results?");
    const dialog = dialogTitle.closest(".qz-dialog") as HTMLElement;
    expect(dialog).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear history" }));
    await Promise.resolve();

    expect(useCalcHistory.getState().history).toEqual([]);
  });

  it("declining the confirm keeps the history (item 1, real ConfirmDialog)", async () => {
    useCalcHistory.setState({
      history: [
        { id: "a", domain: "Optics", label: "calc a", summary: "n = 1.5", ts: "2026-07-19T00:00:00.000Z" },
      ],
      favorites: [],
    });
    render(<CalcOnlyApp />);
    fireEvent.change(screen.getByLabelText("calculator"), { target: { value: "history" } });
    fireEvent.click(screen.getByText("Clear history"));

    const dialogTitle = await screen.findByText("Clear 1 calculator result?");
    const dialog = dialogTitle.closest(".qz-dialog") as HTMLElement;
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await Promise.resolve();

    expect(useCalcHistory.getState().history).toHaveLength(1);
  });
});
