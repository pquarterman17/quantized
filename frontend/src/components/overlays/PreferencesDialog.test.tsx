import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import PreferencesDialog from "./PreferencesDialog";
import { useApp } from "../../store/useApp";

describe("PreferencesDialog", () => {
  beforeEach(() => useApp.getState().setPrefsOpen(false));
  afterEach(() => {
    useApp.getState().setPrefsOpen(false);
    useApp.getState().setTheme("dark");
  });

  it("renders nothing when closed", () => {
    const { container } = render(<PreferencesDialog />);
    expect(container.querySelector(".qzk-prefs")).toBeNull();
  });

  it("shows the tabs and switches panes", () => {
    useApp.getState().setPrefsOpen(true);
    render(<PreferencesDialog />);
    expect(screen.getByText("Preferences")).toBeInTheDocument();
    expect(screen.getByText("Reduce motion")).toBeInTheDocument(); // Appearance default
    fireEvent.click(screen.getByText("Numbers"));
    expect(screen.getByText("Significant figures")).toBeInTheDocument();
  });

  it("changing the theme applies live + updates the store", () => {
    useApp.getState().setPrefsOpen(true);
    render(<PreferencesDialog />);
    fireEvent.click(screen.getByText("Light"));
    expect(useApp.getState().theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("Origin book click opens (WORKSHEET_PLAN item 15) defaults to Worksheet and can switch to Plot", () => {
    useApp.getState().setPrefsOpen(true);
    render(<PreferencesDialog />);
    fireEvent.click(screen.getByText("Interaction"));
    expect(useApp.getState().originBookClickOpens).toBe("worksheet");
    const worksheetBtn = screen.getByRole("tab", { name: "Worksheet" });
    expect(worksheetBtn).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Plot" }));
    expect(useApp.getState().originBookClickOpens).toBe("plot");
    fireEvent.click(worksheetBtn);
    expect(useApp.getState().originBookClickOpens).toBe("worksheet");
  });

  it("closes via Done and Escape", async () => {
    useApp.getState().setPrefsOpen(true);
    const { rerender } = render(<PreferencesDialog />);
    fireEvent.click(screen.getByText("Done"));
    expect(useApp.getState().prefsOpen).toBe(false);

    useApp.getState().setPrefsOpen(true);
    rerender(<PreferencesDialog />);
    fireEvent.keyDown(window, { key: "Escape" });
    // Escape now goes through the ordered registry (`lib/escapeStack.ts`,
    // BUG-018), whose walk is deferred one macrotask, so wait on the STATE the
    // close produces rather than reading it in the same tick.
    await waitFor(() => expect(useApp.getState().prefsOpen).toBe(false));
  });
});

// R1 (P3.3): focus-in/Tab-trap/Escape/restore driven via userEvent at
// document.activeElement (not fireEvent.keyDown on the box).
describe("PreferencesDialog focus-in / Tab trap / Escape / restore (P3.3 R1)", () => {
  afterEach(() => useApp.getState().setPrefsOpen(false));

  afterEach(() => useApp.getState().setTheme("dark"));

  it("moves focus into the ACTIVE PANE on open, onto Theme — not the raw first-in-DOM Close button", () => {
    useApp.getState().setPrefsOpen(true);
    render(<PreferencesDialog />);
    // The Appearance tab's first control: the "Dark" segmented-control tab.
    expect(screen.getByRole("tab", { name: "Dark" })).toHaveFocus();
  });

  // Round 8 (review NIT 3). Both themes, because the landing spot is only
  // ever WRONG in the theme the shipped test did not cover: `SegmentedControl`
  // has no roving `tabindex`, so "first focusable in DOM order" is always
  // "Dark", which under `theme: "light"` is an `aria-selected="false"` option
  // — a screen reader announced "Dark, tab, not selected" as the entry point
  // and Enter/Space there flipped the theme. The landing spot must be the
  // option that is actually SELECTED.
  it.each([
    ["dark" as const, "Dark"],
    ["light" as const, "Light"],
  ])("lands on the SELECTED Theme segment, not the first one, with theme %s", (theme, expected) => {
    useApp.getState().setTheme(theme);
    useApp.getState().setPrefsOpen(true);
    render(<PreferencesDialog />);
    const landed = document.activeElement as HTMLElement;
    expect(landed).toBe(screen.getByRole("tab", { name: expected }));
    // The property that matters, stated directly: whatever it landed on is
    // the CURRENT value. A regression to first-in-DOM makes this false under
    // `light` while still landing on a `role="tab"`.
    expect(landed).toHaveAttribute("aria-selected", "true");
  });

  it("Tab traps at the dialog's real boundary (the Close button first, Done last), even though focus-in skipped past Close", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">outside</button>
        <PreferencesDialog />
      </>,
    );
    act(() => useApp.getState().setPrefsOpen(true));

    const closeBtn = document.querySelector(".qzk-prefs-x") as HTMLElement;
    const dark = screen.getByRole("tab", { name: "Dark" });
    const done = screen.getByRole("button", { name: "Done" });
    expect(dark).toHaveFocus();

    // Backward off the landing spot reaches Close — its DOM predecessor.
    await user.tab({ shift: true });
    expect(closeBtn).toHaveFocus();

    // Close is the trap's actual FIRST element: Shift+Tab from it wraps to
    // the LAST (Done), not out to the page behind the backdrop.
    await user.tab({ shift: true });
    expect(done).toHaveFocus();
    expect(screen.getByRole("button", { name: "outside" })).not.toHaveFocus();

    // And forward from Done (the last) wraps back to Close (the first).
    await user.tab();
    expect(closeBtn).toHaveFocus();
  });

  it("Escape (via the keyboard) closes it and gives focus back to the opener", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">opener</button>
        <PreferencesDialog />
      </>,
    );
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();

    act(() => useApp.getState().setPrefsOpen(true));
    expect(opener).not.toHaveFocus();

    await user.keyboard("{Escape}");
    expect(useApp.getState().prefsOpen).toBe(false);
    expect(opener).toHaveFocus();
  });
});
