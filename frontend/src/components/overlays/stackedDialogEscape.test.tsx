// BUG-018 — stacked backdrop dialogs, one Escape, one action.
//
// THE DEFECT THIS PINS THE FIX FOR. Every backdrop dialog in this folder used
// to register its Escape handler as `window.addEventListener("keydown", onKey,
// true)` and call `e.stopPropagation()`. `stopPropagation()` does NOT stop
// another listener on the SAME node in the SAME phase — that needs
// `stopImmediatePropagation()` — so with two of these mounted, BOTH handlers
// ran on ONE keystroke. `Ctrl+,` then `?` then one Escape took
// `[role="dialog"]` from 2 to 0, and over a pending `ConfirmDialog` the same
// key silently resolved a destructive-action confirmation `false`.
//
// THE FIX (P3.3 round 9). All ten backdrop dialogs are now surfaces in the
// app's one ordered Escape registry (`lib/escapeStack.ts`) on its new `modal`
// layer — the top of the ladder, and the one layer that TRAPS the key: the
// innermost open dialog closes and nothing below it acts on the same
// keystroke. The `modal` layer also suspends the dispatcher's
// `isEditingTarget` / `cmdkOpen` / `.qzk-ctx` early returns, because a modal
// by definition owns Escape and four of these ten land focus on an `<input>`
// or `<select>` by design. Those four landing spots are pinned individually in
// their own dialogs' test files (Help's search box, Separate's and Combine's
// Name field, Split's Column select) — that is the acceptance criterion an
// earlier attempt at this fix failed.
//
// These cases were written as the reproduction (each `ACTUAL` recorded the
// defect with the `INTENDED` value next to it); they now assert the intended
// ladder directly.

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import ConfirmDialog, { askConfirm } from "./ConfirmDialog";
import HelpDialog from "./HelpDialog";
import PreferencesDialog from "./PreferencesDialog";
import ShortcutsDialog from "./ShortcutsDialog";
import { useApp } from "../../store/useApp";
import { useHelp } from "../../store/help";

/** Let the escape registry's deferred walk (one macrotask) run. */
const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
};

const openDialogs = () => document.querySelectorAll('[role="dialog"]').length;

describe("BUG-018 — one Escape closes the INNERMOST backdrop dialog only", () => {
  beforeEach(() => {
    useApp.getState().setPrefsOpen(false);
    useApp.getState().setShortcutsOpen(false);
    useHelp.getState().closeHelp();
  });

  it("Preferences under Shortcuts: Escape closes Shortcuts, the next closes Preferences", async () => {
    const user = userEvent.setup();
    render(
      <>
        <PreferencesDialog />
        <ShortcutsDialog />
      </>,
    );
    act(() => useApp.getState().setPrefsOpen(true));
    act(() => useApp.getState().setShortcutsOpen(true));
    expect(openDialogs()).toBe(2);

    await user.keyboard("{Escape}");
    await settle();

    expect(openDialogs()).toBe(1);
    expect(useApp.getState().shortcutsOpen).toBe(false);
    expect(useApp.getState().prefsOpen).toBe(true);

    await user.keyboard("{Escape}");
    await settle();

    expect(openDialogs()).toBe(0);
    expect(useApp.getState().prefsOpen).toBe(false);
  });

  it("Preferences under Help: Escape closes Help, the next closes Preferences", async () => {
    const user = userEvent.setup();
    render(
      <>
        <PreferencesDialog />
        <HelpDialog />
      </>,
    );
    act(() => useApp.getState().setPrefsOpen(true));
    act(() => useHelp.getState().openHelp());
    expect(openDialogs()).toBe(2);

    await user.keyboard("{Escape}");
    await settle();

    expect(openDialogs()).toBe(1);
    expect(useHelp.getState().open).toBe(false);
    expect(useApp.getState().prefsOpen).toBe(true);

    await user.keyboard("{Escape}");
    await settle();

    expect(openDialogs()).toBe(0);
    expect(useApp.getState().prefsOpen).toBe(false);
  });

  // The sharpest case: `askConfirm` is the app's styled replacement for
  // `window.confirm` on destructive actions. The keystroke aimed at
  // Preferences must not answer a question the user is not looking at.
  it("Preferences over a pending ConfirmDialog: Escape closes Preferences and leaves the confirm PENDING", async () => {
    const user = userEvent.setup();
    render(
      <>
        <PreferencesDialog />
        <ConfirmDialog />
      </>,
    );
    let settled: boolean | "pending" = "pending";
    let asked!: Promise<boolean>;
    act(() => {
      asked = askConfirm("Delete everything?", "no undo", "Delete", true);
    });
    void asked.then((v) => {
      settled = v;
    });
    // Preferences opens ON TOP of the pending confirm, so Preferences is the
    // innermost surface and the only one this keystroke should reach.
    act(() => useApp.getState().setPrefsOpen(true));
    expect(openDialogs()).toBe(2);

    await user.keyboard("{Escape}");
    await settle();

    expect(useApp.getState().prefsOpen).toBe(false);
    expect(screen.queryByText("Delete everything?")).not.toBeNull();
    expect(settled).toBe("pending");
    expect(openDialogs()).toBe(1);

    // The SECOND Escape reaches the confirmation, and only then answers it.
    await user.keyboard("{Escape}");
    await settle();

    await expect(asked).resolves.toBe(false);
    expect(settled).toBe(false);
    expect(openDialogs()).toBe(0);
  });

  // The control that proves the cases above are about STACKING and not about
  // Escape being broken generally: a single dialog closes on exactly one
  // Escape, as it always has.
  it("control — a LONE backdrop dialog still closes on one Escape", async () => {
    const user = userEvent.setup();
    render(<PreferencesDialog />);
    act(() => useApp.getState().setPrefsOpen(true));
    expect(openDialogs()).toBe(1);

    await user.keyboard("{Escape}");
    await settle();

    expect(openDialogs()).toBe(0);
    expect(useApp.getState().prefsOpen).toBe(false);
  });
});
