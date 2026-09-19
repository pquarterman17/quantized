// DIVERGENCE (BUG-018) — stacked backdrop dialogs all claim the same Escape.
//
// Every backdrop dialog in this folder registers its Escape handler as
// `window.addEventListener("keydown", onKey, true)` and calls
// `e.stopPropagation()`. `stopPropagation()` does NOT stop another listener
// on the SAME node in the SAME phase — that needs `stopImmediatePropagation()`
// — so when two of these are mounted, BOTH handlers run on ONE keystroke.
// One Escape, two actions: the class `lib/escapeStack.ts` exists to prevent,
// in the one case (dialog over dialog) its ordering apparatus was built for.
//
// These tests PIN THE DEFECT, deliberately, in the house style the P4.2
// regression matrix uses for a filed-but-unfixed divergence: assert the
// concrete values BOTH sides produce and assert that they differ from the
// intended ladder. They are the reproduction BUG-018 is filed on. When the
// bug is fixed, each `ACTUAL` expectation inverts to the `INTENDED` one
// recorded next to it — the tests are written so that is a one-line edit.
//
// Why this is not simply fixed here: migrating these dialogs onto
// `useEscapeSurface("window", …)` was BUILT and MEASURED on this tree
// (2026-09-19) and reverted. It does fix the ladder — measured, one Escape
// per dialog, innermost first, and a stacked confirm stays pending — but the
// registry's dispatcher bails on `isEditingTarget(event.target)`, and FOUR of
// the ten dialogs land focus on an `<input>` or `<select>` by design (Help's
// search box, Separate's and Combine's Name field, Split's Column select).
// Those four became Escape-DEAD from their own documented landing spot. See
// BUG-018's entry for the full measurement.

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import ConfirmDialog, { askConfirm } from "./ConfirmDialog";
import HelpDialog from "./HelpDialog";
import PreferencesDialog from "./PreferencesDialog";
import { useApp } from "../../store/useApp";
import { useHelp } from "../../store/help";

/** Let the escape registry's deferred walk (one macrotask) run, so a fix that
 *  routes these dialogs through `lib/escapeStack.ts` is measured fairly
 *  rather than failing merely for being asynchronous. */
const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
};

const openDialogs = () => document.querySelectorAll('[role="dialog"]').length;

describe("DIVERGENCE (BUG-018) — one Escape closes two stacked backdrop dialogs", () => {
  beforeEach(() => {
    useApp.getState().setPrefsOpen(false);
    useHelp.getState().closeHelp();
  });

  it("Preferences over Help: ONE Escape closes BOTH (intended: Help only, Preferences on the next)", async () => {
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

    // ACTUAL: both gone. INTENDED: 1 — Help (the innermost) closes, and
    // Preferences is still open waiting for the next Escape.
    expect(openDialogs()).toBe(0);
    expect(useHelp.getState().open).toBe(false);
    expect(useApp.getState().prefsOpen).toBe(false); // INTENDED: true
    // Said as a difference, so the test reads as the bug and not as a spec.
    expect(openDialogs()).not.toBe(1);
  });

  it("Preferences over a pending ConfirmDialog: ONE Escape dismisses Preferences AND answers the confirm", async () => {
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

    // ACTUAL: Preferences closed AND the destructive-action confirmation was
    // silently answered "no" by the same keystroke. INTENDED: Preferences
    // closes, `settled` is still "pending", and the confirm resolves `false`
    // only on the SECOND Escape.
    expect(useApp.getState().prefsOpen).toBe(false);
    expect(screen.queryByText("Delete everything?")).toBeNull(); // INTENDED: still mounted
    expect(settled).toBe(false); // INTENDED: "pending"
    expect(settled).not.toBe("pending");
    expect(openDialogs()).toBe(0); // INTENDED: 1
  });

  // The control that proves the two cases above are about STACKING and not
  // about Escape being broken generally: a single dialog closes on exactly
  // one Escape, as it always has.
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
