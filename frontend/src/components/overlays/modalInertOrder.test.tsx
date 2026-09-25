// R12/R16 — which of two stacked dialogs is the ONE active modal.
//
// With the background `inert`, "active" is no longer a Tab-only question: the
// dialog that loses is inert too — no pointer, no focus, out of the
// accessibility tree. So the dialog Escape closes, the dialog Tab cycles in,
// the dialog left live AND the dialog painted on top must all be one dialog.
// They are now all the dialog OPENED LAST: `lib/escapeStack.ts` already ranked
// Escape that way, and lib/modalInert.ts stamps each open backdrop's z-index
// in open order so the paint follows.
//
// Measured in Chromium on 2026-09-25 before this (main and the first R12 cut
// alike): `?` pressed in Help or Preferences opened Shortcuts — which sits
// EARLIER in AppOverlays — UNDERNEATH the open dialog, since equal z-index
// paints in tree order; it was invisible, and the first Escape closed it,
// so nothing the user could see changed.

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { create } from "zustand";

import HelpDialog from "./HelpDialog";
import PreferencesDialog from "./PreferencesDialog";
import ShortcutsDialog from "./ShortcutsDialog";
import { useGlobalShortcuts } from "../../useGlobalShortcuts";
import { useApp } from "../../store/useApp";
import { useHelp } from "../../store/help";

/** Shortcuts mounts on demand, EARLIER in the tree than Help/Preferences —
 *  AppOverlays' own order — so tree order, mount order and open order can
 *  all be made to differ. */
const useMount = create(() => ({ shortcuts: true }));
function Keys() {
  useGlobalShortcuts();
  return null;
}
function Shell() {
  const shortcuts = useMount((s) => s.shortcuts);
  const help = useHelp((s) => s.open);
  return (
    <div className="qzk-app">
      <Keys />
      <div className="qzk-main">
        <button type="button">background control</button>
      </div>
      {shortcuts && <ShortcutsDialog />}
      {help && <HelpDialog />}
      <PreferencesDialog />
    </div>
  );
}

const inertAncestor = (el: Element | null): Element | null => el?.closest("[inert]") ?? null;
const z = (dialog: HTMLElement) => Number((dialog.closest(".qz-overlay-backdrop") as HTMLElement).style.zIndex);
const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
};
const reset = () => {
  useApp.getState().setPrefsOpen(false);
  useApp.getState().setShortcutsOpen(false);
  useHelp.setState({ open: false });
  useMount.setState({ shortcuts: true });
};
beforeEach(reset);
afterEach(reset);

/** The full contract for `under` open, then `?` pressed from `opener`
 *  inside it: Shortcuts is visible on top, live, focused and Tab-trapped;
 *  the first Escape closes IT, handing `under` back its focus; the second
 *  closes `under`; nothing is left inert. */
async function questionMarkOver(under: HTMLElement, opener: HTMLElement): Promise<void> {
  const user = userEvent.setup();
  act(() => opener.focus());
  await user.keyboard("?");
  const shortcuts = screen.getByRole("dialog", { name: /shortcuts/i });

  // Painted on top of the dialog it was opened from, although it is EARLIER
  // in the tree — the stamp, not tree order, decides.
  expect(under.compareDocumentPosition(shortcuts) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  expect(z(shortcuts)).toBeGreaterThan(z(under));
  expect(inertAncestor(shortcuts)).toBeNull();
  expect(inertAncestor(under)).not.toBeNull();
  // Focus and Tab are Shortcuts'.
  expect(shortcuts.contains(document.activeElement)).toBe(true);
  const items = Array.from(shortcuts.querySelectorAll<HTMLElement>("button:not([disabled])"));
  act(() => items[items.length - 1].focus());
  await user.tab();
  expect(shortcuts.contains(document.activeElement)).toBe(true);

  // First Escape closes what the user sees on top.
  await user.keyboard("{Escape}");
  await settle();
  expect(screen.queryByRole("dialog", { name: /shortcuts/i })).toBeNull();
  expect(inertAncestor(under)).toBeNull();
  expect(opener).toHaveFocus();

  // Second Escape closes the one beneath; nothing is left inert.
  await user.keyboard("{Escape}");
  await settle();
  expect(screen.queryAllByRole("dialog")).toHaveLength(0);
  expect(document.querySelectorAll("[inert]")).toHaveLength(0);
}

describe("R16 — `?` opens Shortcuts ON TOP of the dialog it was pressed in", () => {
  it("Help → ?", async () => {
    render(<Shell />);
    await act(async () => useHelp.getState().openHelp());
    const help = screen.getByRole("dialog", { name: "Help" });
    await questionMarkOver(help, help.querySelector<HTMLElement>("[role='tab']")!);
  });

  it("Preferences → ?, on first open and on reopen", async () => {
    render(<Shell />);
    for (const round of ["first open", "reopen"]) {
      await act(async () => useApp.getState().setPrefsOpen(true));
      const prefs = screen.getByRole("dialog", { name: /preferences/i });
      const opener = prefs.querySelector<HTMLElement>("button")!;
      await questionMarkOver(prefs, opener).catch((e: unknown) => {
        throw new Error(`${round}: ${String(e)}`);
      });
    }
  });
});

describe("R16 — open order beats mount order and tree order", () => {
  it("Preferences mounted FIRST, opened LAST, is the active modal and the first Escape closes it", async () => {
    const user = userEvent.setup();
    useMount.setState({ shortcuts: false });
    render(<Shell />);
    // Preferences mounts (and opens, then closes) first...
    await act(async () => useApp.getState().setPrefsOpen(true));
    await act(async () => useApp.getState().setPrefsOpen(false));
    // ...Shortcuts mounts later, earlier in the tree, and opens...
    await act(async () => useMount.setState({ shortcuts: true }));
    await act(async () => useApp.getState().setShortcutsOpen(true));
    // ...and Preferences is REOPENED over it.
    await act(async () => useApp.getState().setPrefsOpen(true));

    const prefs = screen.getByRole("dialog", { name: /preferences/i });
    const shortcuts = screen.getByRole("dialog", { name: /shortcuts/i });
    expect(inertAncestor(prefs)).toBeNull();
    expect(inertAncestor(shortcuts)).not.toBeNull();
    expect(z(prefs)).toBeGreaterThan(z(shortcuts));
    // Tab wraps inside Preferences, not pulled into the inert one beneath.
    const buttons = Array.from(prefs.querySelectorAll<HTMLElement>("button:not([disabled])"));
    act(() => buttons[buttons.length - 1].focus());
    await user.tab();
    expect(document.activeElement).toBe(buttons[0]);

    await user.keyboard("{Escape}");
    await settle();
    expect(screen.queryByRole("dialog", { name: /preferences/i })).toBeNull();
    expect(inertAncestor(shortcuts)).toBeNull();
    await user.keyboard("{Escape}");
    await settle();
    expect(screen.queryAllByRole("dialog")).toHaveLength(0);
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
    // The stamps are lifted with the walk.
    expect(document.querySelectorAll<HTMLElement>(".qz-overlay-backdrop[style*='z-index']")).toHaveLength(0);
  });
});
