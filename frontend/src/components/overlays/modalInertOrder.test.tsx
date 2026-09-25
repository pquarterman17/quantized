// R12 — which of two stacked dialogs is the ONE active modal.
//
// With the background `inert`, "active" is no longer a Tab-only question: the
// dialog that loses is inert too — no pointer, no focus, out of the
// accessibility tree. So the winner must be the dialog the user SEES on top.
// Every dialog sits in a `.qz-overlay-backdrop` of the same z-index in one
// stacking context, so the one painted on top is the one LAST IN DOCUMENT
// ORDER, and lib/modalInert.ts and the Tab trap both follow it.
//
// The rule it replaced (component MOUNT order) was measured wrong in Chromium
// on 2026-09-25: Preferences stays mounted after its first close, so when it
// was reopened with Ctrl+, over Help it painted on top but ranked below —
// inert, visibly on top, and dead to the pointer and to Tab.

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { create } from "zustand";

import PreferencesDialog from "./PreferencesDialog";
import ShortcutsDialog from "./ShortcutsDialog";
import { useApp } from "../../store/useApp";

/** Mounts Shortcuts on demand, BEFORE Preferences in the tree — so it is
 *  mounted later but painted beneath, the kept-mounted shape of AppOverlays. */
const useMount = create(() => ({ shortcuts: false }));
function Shell() {
  const shortcuts = useMount((s) => s.shortcuts);
  return (
    <div className="qzk-app">
      <div className="qzk-main">
        <button type="button">background control</button>
      </div>
      {shortcuts && <ShortcutsDialog />}
      <PreferencesDialog />
    </div>
  );
}

const inertAncestor = (el: Element | null): Element | null => el?.closest("[inert]") ?? null;
const reset = () => {
  useApp.getState().setPrefsOpen(false);
  useApp.getState().setShortcutsOpen(false);
  useMount.setState({ shortcuts: false });
};
beforeEach(reset);
afterEach(reset);

describe("R12 — the active modal is the one painted on top", () => {
  it("Preferences, mounted FIRST but later in the tree, stays active over a dialog opened after it", async () => {
    render(<Shell />);
    // Preferences mounts (and opens) first...
    await act(async () => useApp.getState().setPrefsOpen(true));
    // ...then a dialog that MOUNTS later but sits earlier in the tree opens.
    await act(async () => useMount.setState({ shortcuts: true }));
    await act(async () => useApp.getState().setShortcutsOpen(true));

    const prefs = screen.getByRole("dialog", { name: /preferences/i });
    const shortcuts = screen.getByRole("dialog", { name: /shortcuts/i });
    // Tree order is paint order: Preferences is the one on top, so it is the
    // one live — by mount order it would have been Shortcuts, leaving the
    // dialog the user sees inert.
    expect(shortcuts.compareDocumentPosition(prefs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(inertAncestor(prefs)).toBeNull();
    expect(inertAncestor(shortcuts)).not.toBeNull();
  });

  it("the Tab trap follows the same dialog as the inert walk", async () => {
    const user = userEvent.setup();
    render(<Shell />);
    await act(async () => useApp.getState().setPrefsOpen(true));
    await act(async () => useMount.setState({ shortcuts: true }));
    await act(async () => useApp.getState().setShortcutsOpen(true));

    const prefs = screen.getByRole("dialog", { name: /preferences/i });
    const buttons = Array.from(prefs.querySelectorAll<HTMLElement>("button:not([disabled])"));
    act(() => buttons[buttons.length - 1].focus());
    await user.tab();
    // Wrapped inside Preferences — the live dialog — not pulled into the
    // inert one beneath it.
    expect(prefs.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
  });
});
