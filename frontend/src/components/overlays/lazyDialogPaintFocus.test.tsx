// The HAND-OFF window of the lazy promise dialogs (bundle diet slice 8): the
// moment the body chunk arrives and the body replaces the pending guard.
//
// Found as a one-off full-suite failure of dialogFocus.a11y.test.tsx
// ("Tab wraps between Cancel and the confirm button": focus on <body> right
// after `findByRole("dialog")`). The mechanism: `useRegionLoaded` flipped
// `ready` with a plain setState from the chunk's promise -- a DEFAULT-lane
// update, which React renders and commits in a Scheduler task. That commit
// inserts the body and runs layout effects (the background goes `inert`,
// and `usePendingDialogGuard`'s cleanup drops its Enter/Space swallow), but
// the body's PASSIVE effects (focus in, the Enter handler, the Tab trap) are
// a SEPARATE Scheduler task, and the Scheduler always yields to the host
// after a commit (`requestPaint` -> `shouldYieldToHost()` is true). So for
// one macrotask the dialog is on screen with the guard gone and focus still
// on the (now inert) control behind the backdrop. Anything else queued for
// the next macrotask can land in that gap: a user's key, or -- the flake --
// RTL's `asyncWrapper`, which resumes the test from a `setTimeout(0)` that
// beats the passive flush's `setImmediate` whenever the worker is loaded
// enough for >= 1 ms to pass. The fix commits the flip with `flushSync`: a
// sync-lane commit, whose passive effects React flushes before it returns.
//
// FORCED, not repeated (docs/testing.md): no timer race is needed at all. A
// MutationObserver probes the dialog at the FIRST MICROTASK after it is
// inserted, i.e. before any later macrotask can run -- the worst case the
// timer race can only sometimes reach -- reading `document.activeElement`
// and pressing Shift+Tab. Deterministic in both directions: unfixed, focus
// is still on the opener there and nothing traps the Tab, every time; fixed,
// the body's passive effects have already run inside the committing call.

import { act, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";

import ConfirmDialog, { askConfirm } from "./ConfirmDialog";
import ParamDialog, { askParams } from "./ParamDialog";
// Warm the bodies' dependencies (never the bodies -- they must stay held).
import "../primitives";
import "./ParamFields";
import "./useDialogFocus";

const { gates } = vi.hoisted(() => {
  const gate = () => {
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    return { held, release: () => release() };
  };
  return { gates: { confirm: gate(), params: gate() } };
});

/** The real body, held until the test releases it (the in-flight fetch). */
async function heldBody(
  held: Promise<void>,
  importOriginal: () => Promise<{ default: ComponentType }>,
): Promise<{ default: ComponentType }> {
  await held;
  return await importOriginal();
}

vi.mock("./ConfirmDialogBody", (importOriginal: () => Promise<{ default: ComponentType }>) =>
  heldBody(gates.confirm.held, importOriginal),
);
vi.mock("./ParamDialogBody", (importOriginal: () => Promise<{ default: ComponentType }>) =>
  heldBody(gates.params.held, importOriginal),
);

interface AtPaint {
  /** `document.activeElement` when the dialog first appeared. */
  focus: Element | null;
  /** Whether a Shift+Tab pressed right then was taken by the dialog's trap
   *  (Shift+Tab off the first control wraps to the last, default-prevented)
   *  rather than left to walk out to the page behind. */
  tabTrapped: boolean;
}

/** Probe the dialog at the first microtask after it enters the DOM. */
function probeAtPaint(): { read: () => AtPaint | undefined; stop: () => void } {
  let atPaint: AtPaint | undefined;
  const mo = new MutationObserver(() => {
    if (atPaint !== undefined || !document.querySelector('[role="dialog"]')) return;
    const focus = document.activeElement;
    const shiftTab = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    (focus ?? document.body).dispatchEvent(shiftTab);
    atPaint = { focus, tabTrapped: shiftTab.defaultPrevented };
  });
  mo.observe(document.body, { childList: true, subtree: true });
  return { read: () => atPaint, stop: () => mo.disconnect() };
}

describe("a lazy dialog body takes focus in the same task that paints it", () => {
  it("forces the hand-off race: confirm", async () => {
    render(
      <>
        <button type="button">opener</button>
        <ConfirmDialog />
      </>,
    );
    screen.getByRole("button", { name: "opener" }).focus();
    const probe = probeAtPaint();
    let result!: Promise<boolean>;
    act(() => {
      result = askConfirm("Remove everything?", "gone forever", "Remove all", true);
    });
    expect(screen.queryByRole("dialog")).toBeNull(); // the chunk is held

    // Released OUTSIDE act: the chunk's arrival reaches React the way it does
    // in the app, through the Scheduler, not through act's synchronous queue.
    gates.confirm.release();
    await screen.findByRole("dialog");
    probe.stop();

    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(probe.read()).toEqual({ focus: cancel, tabTrapped: true });

    await act(async () => {
      cancel.click();
      await expect(result).resolves.toBe(false);
    });
  });

  it("forces the hand-off race: a zero-field params dialog", async () => {
    render(
      <>
        <button type="button">opener</button>
        <ParamDialog />
      </>,
    );
    screen.getByRole("button", { name: "opener" }).focus();
    const probe = probeAtPaint();
    let result!: Promise<unknown>;
    act(() => {
      result = askParams("Proceed?", []);
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    gates.params.release();
    await screen.findByRole("dialog");
    probe.stop();

    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(probe.read()).toEqual({ focus: cancel, tabTrapped: true });

    await act(async () => {
      cancel.click();
      await expect(result).resolves.toBeNull();
    });
  });
});
