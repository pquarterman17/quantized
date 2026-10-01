// Help's section strip as a WAI-ARIA tablist: roving tabindex, Left/Right/
// Home/End, MANUAL activation. Selecting Topics moves focus into its search
// box, so selecting on focus would pull focus out of the strip mid-arrow.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import HelpDialog from "./HelpDialog";
import { useHelp } from "../../store/help";
import { useCommands } from "../../store/commands";

beforeEach(() => {
  useHelp.setState({ open: false, section: "shortcuts", query: "" });
  useCommands.setState({ menuCommands: [] });
});
afterEach(() => act(() => useHelp.getState().closeHelp()));

function openHelp() {
  render(<HelpDialog />);
  act(() => useHelp.setState({ open: true }));
  const list = screen.getByRole("tablist", { name: "Help sections" });
  return within(list).getAllByRole("tab");
}

describe("Help section tabs", () => {
  it("control one panel labelled by the selected tab, and are one Tab stop", () => {
    const tabs = openHelp();
    const panel = screen.getByRole("tabpanel", { name: "Keyboard & mouse" });
    for (const t of tabs) expect(t).toHaveAttribute("aria-controls", panel.id);
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0, -1, -1, -1]);
    // The landing spot is the selected tab, not the first one.
    expect(tabs[1]).toHaveFocus();
  });

  it("arrows move focus without selecting; Enter selects", async () => {
    const user = userEvent.setup();
    const tabs = openHelp();
    fireEvent.keyDown(tabs[1], { key: "ArrowRight" });
    expect(tabs[2]).toHaveFocus();
    expect(useHelp.getState().section).toBe("shortcuts");
    fireEvent.keyDown(tabs[2], { key: "End" });
    expect(tabs[4]).toHaveFocus();
    fireEvent.keyDown(tabs[4], { key: "ArrowRight" });
    expect(tabs[0]).toHaveFocus();
    fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
    expect(tabs[4]).toHaveFocus();
    fireEvent.keyDown(tabs[4], { key: "Home" });
    expect(tabs[0]).toHaveFocus();
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    fireEvent.keyDown(tabs[1], { key: "ArrowRight" });
    await user.keyboard("{Enter}");
    expect(useHelp.getState().section).toBe("importing");
    expect(screen.getByRole("tabpanel", { name: "Importing data" })).toBeInTheDocument();
    expect(tabs[2].tabIndex).toBe(0);
  });

  it("Shift+Tab from the selected tab wraps inside the dialog past the unselected ones", async () => {
    const user = userEvent.setup();
    const tabs = openHelp();
    expect(tabs[1]).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("dialog", { name: "Help" })).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  });
});
