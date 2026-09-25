// R12 — a modal dialog must not silence the app's live regions, and only one
// dialog at a time may be the active modal.
//
// THE DEFECT THESE PIN THE FIX FOR. Every backdrop dialog carried
// `aria-modal="true"`, which tells assistive tech to ignore everything outside
// the dialog. The app announces through two `aria-live` regions that are
// outside every dialog — `Toaster` and the status bar's "Background
// operations" region — so a toast or a progress update raised while any dialog
// was open was silently never announced. Two dialogs could also be mounted at
// once, each claiming `aria-modal`, which is undefined behaviour.
//
// WHAT THIS FILE CAN AND CANNOT PROVE. jsdom implements no `inert` (measured
// 2026-09-19 and again 2026-09-25: no property, `isInaccessible` ignores it,
// `focus()` lands inside one); `src/test/setup.ts` reflects the property only,
// so modalInert takes its primary path here. These cases therefore pin WHERE
// the attribute lands, and `e2e/specs/modal-inert.spec.ts` pins what it DOES
// in real Chromium. The DOM-mutation gap is pinned in
// modalInertMutations.test.tsx, abnormal unmounts and the lazy bodies in
// modalInertRelease.test.tsx.

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ConfirmDialog, { askConfirm } from "./ConfirmDialog";
import PreferencesDialog from "./PreferencesDialog";
import ShortcutsDialog from "./ShortcutsDialog";
import Toaster from "./Toaster";
import StatusBar from "../Shell/StatusBar";
import { LIVE_REGION_ATTR, openModalCount } from "../../lib/modalInert";
import { useApp } from "../../store/useApp";
import { toast, useToasts } from "../../store/toasts";
// Warm the lazy confirm body's module graph: its FIRST dynamic import here
// otherwise pays a cold transform (~1 s under a loaded run, measured), which
// is the whole of `findByRole`'s default budget.
import "./ConfirmDialogBody";

/** Let the escape registry's deferred walk (one macrotask) run. */
const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
};

/** The app shell's real shape around the dialogs: a background column, the
 *  status bar, the dialogs themselves and the toast stack, all siblings under
 *  the app root — which is exactly the arrangement that made `aria-modal`
 *  fatal to the live regions and is what the inert walk has to get right. */
function Shell() {
  return (
    <div className="qzk-app">
      <div className="qzk-main">
        <button type="button">background control</button>
      </div>
      <StatusBar />
      <PreferencesDialog />
      <ShortcutsDialog />
      <ConfirmDialog />
      <Toaster />
    </div>
  );
}

const inertAncestor = (el: Element | null): Element | null => el?.closest("[inert]") ?? null;
const liveRegion = () => screen.getByRole("status", { name: "Background operations" });

beforeEach(() => {
  useApp.getState().setPrefsOpen(false);
  useApp.getState().setShortcutsOpen(false);
  useToasts.setState({ toasts: [] });
});

afterEach(() => {
  useApp.getState().setPrefsOpen(false);
  useApp.getState().setShortcutsOpen(false);
  useToasts.setState({ toasts: [] });
});

describe("R12 — a dialog inerts the background", () => {
  it("makes the background inert while open and leaves nothing inert on close", async () => {
    render(<Shell />);
    const background = document.querySelector(".qzk-main")!;
    expect(inertAncestor(background)).toBeNull();

    await act(async () => useApp.getState().setPrefsOpen(true));
    expect(background).toHaveAttribute("inert");

    await act(async () => useApp.getState().setPrefsOpen(false));
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
    expect(openModalCount()).toBe(0);
  });

  it("leaves the open dialog and its own backdrop reachable", async () => {
    render(<Shell />);
    await act(async () => useApp.getState().setPrefsOpen(true));
    const dialog = screen.getByRole("dialog");
    expect(inertAncestor(dialog)).toBeNull();
    // The backdrop is ON the path from the dialog to the root, so
    // click-to-dismiss keeps working.
    expect(dialog.closest(".qz-overlay-backdrop")).not.toHaveAttribute("inert");
  });
});

describe("R12 — the live regions stay out of the inert subtree", () => {
  it("a toast raised while a dialog is open is not inert, and stays that way when another dialog opens", async () => {
    render(<Shell />);
    await act(async () => useApp.getState().setPrefsOpen(true));
    // The toast stack renders nothing until there is a toast, so this is the
    // real sequence: dialog first, announcement second.
    await act(async () => toast("Export finished"));

    const toaster = document.querySelector(".qzk-toaster")!;
    expect(toaster).toHaveTextContent("Export finished");
    expect(toaster).not.toHaveAttribute("inert");
    expect(inertAncestor(toaster)).toBeNull();
    // Still the live region it has to be for the announcement to happen at all.
    expect(toaster).toHaveAttribute("aria-live", "polite");

    // Both halves are discriminating now. The toast stack is a NEW node in the
    // background, which the MutationObserver re-walks for (R12 hypothesis b),
    // so without the exemption the first half goes red; the next full walk —
    // a second dialog over the first — is where it is load-bearing again.
    await act(async () => useApp.getState().setShortcutsOpen(true));
    expect(toaster).not.toHaveAttribute("inert");
    expect(inertAncestor(toaster)).toBeNull();
  });

  it("a toast already on screen when a dialog opens is not inerted by it", async () => {
    render(<Shell />);
    await act(async () => toast("Import finished"));
    await act(async () => useApp.getState().setPrefsOpen(true));

    const toaster = document.querySelector(".qzk-toaster")!;
    expect(toaster).not.toHaveAttribute("inert");
    expect(inertAncestor(toaster)).toBeNull();
  });

  it("the status bar's announcements survive, while the rest of the footer goes inert", async () => {
    render(<Shell />);
    await act(async () => useApp.getState().setPrefsOpen(true));

    // The marked region itself is exempt...
    expect(inertAncestor(liveRegion())).toBeNull();
    // ...and the exemption is NARROW: the walk descends into the footer rather
    // than skipping it whole, so the rest of the status bar is still inert.
    const footer = document.querySelector(".qzk-statusbar")!;
    expect(footer).not.toHaveAttribute("inert");
    expect(footer.querySelector(".qzk-conn")).toHaveAttribute("inert");
  });

  it("no dialog carries aria-modal, which would hide the live regions whatever inert says", async () => {
    render(<Shell />);
    await act(async () => useApp.getState().setPrefsOpen(true));
    expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-modal");
  });
});

describe("R12 — exactly one active modal when two are stacked", () => {
  it("inerts the dialog underneath the topmost one", async () => {
    render(<Shell />);
    await act(async () => useApp.getState().setPrefsOpen(true));
    await act(async () => useApp.getState().setShortcutsOpen(true));

    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(2);
    const active = dialogs.filter((d) => inertAncestor(d) === null);
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAccessibleName(/shortcuts/i);
    // The live regions are still exempt with two dialogs stacked.
    expect(inertAncestor(liveRegion())).toBeNull();
  });

  it("hands the active modal back to the dialog underneath when the top one closes", async () => {
    render(<Shell />);
    await act(async () => useApp.getState().setPrefsOpen(true));
    await act(async () => useApp.getState().setShortcutsOpen(true));
    await act(async () => useApp.getState().setShortcutsOpen(false));

    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(1);
    expect(inertAncestor(dialogs[0])).toBeNull();
    expect(document.querySelector(".qzk-main")).toHaveAttribute("inert");
  });

  it("leaves nothing inert when stacked dialogs close OUT OF ORDER", async () => {
    render(<Shell />);
    await act(async () => useApp.getState().setPrefsOpen(true));
    await act(async () => useApp.getState().setShortcutsOpen(true));
    // The one UNDERNEATH closes first — the case a naive "pop the stack"
    // release gets wrong.
    await act(async () => useApp.getState().setPrefsOpen(false));
    expect(document.querySelector(".qzk-main")).toHaveAttribute("inert");
    expect(openModalCount()).toBe(1);

    await act(async () => useApp.getState().setShortcutsOpen(false));
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
    expect(openModalCount()).toBe(0);
  });

  it("leaves nothing inert when the dialogs are dismissed with Escape", async () => {
    const user = userEvent.setup();
    render(<Shell />);
    await act(async () => useApp.getState().setPrefsOpen(true));
    await act(async () => useApp.getState().setShortcutsOpen(true));

    await user.keyboard("{Escape}");
    await settle();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(document.querySelector(".qzk-main")).toHaveAttribute("inert");

    await user.keyboard("{Escape}");
    await settle();
    expect(screen.queryAllByRole("dialog")).toHaveLength(0);
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
    expect(openModalCount()).toBe(0);
  });
});

describe("R12 — inert is lifted before focus is handed back", () => {
  // jsdom lets `focus()` land inside an inert subtree, so the ORDER is the
  // only part of this a unit test can see — but the order is the whole risk:
  // in a browser, restoring focus to an opener whose ancestor is still inert
  // is a silent no-op and the user lands on <body>, which is this app's
  // documented data-loss spot (lib/focusGuard.ts).
  it("no inert attribute is left in the document at the moment the opener is refocused", async () => {
    render(
      <div>
        <button type="button">opener</button>
        <Shell />
      </div>,
    );
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();

    const inertAtFocusTime: number[] = [];
    const realFocus = HTMLElement.prototype.focus;
    const spy = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
      this: HTMLElement,
      ...args: Parameters<HTMLElement["focus"]>
    ) {
      if (this === opener) inertAtFocusTime.push(document.querySelectorAll("[inert]").length);
      return realFocus.apply(this, args);
    });

    const answer = askConfirm("Delete it?");
    await act(async () => {});
    await act(async () => useApp.getState().setPrefsOpen(false));
    // Close it the ordinary way and let the restore run.
    await act(async () => {
      (await screen.findByRole("button", { name: "Cancel" })).click();
    });
    await act(async () => {
      await answer;
    });
    spy.mockRestore();

    expect(inertAtFocusTime.length).toBeGreaterThan(0);
    expect(inertAtFocusTime).toEqual(inertAtFocusTime.map(() => 0));
    expect(opener).toHaveFocus();
  });
});

describe("R12 — the markers, and an engine without `inert`", () => {
  it("the eager live regions spell the marker exactly as modalInert reads it", async () => {
    // Toaster and StatusBar write `data-live-region` as a literal so the
    // entry chunk never imports modalInert; this is what keeps the two
    // spellings from drifting apart.
    render(<Shell />);
    await act(async () => toast("Saved"));
    expect(document.querySelector(".qzk-toaster")).toHaveAttribute(LIVE_REGION_ATTR);
    expect(liveRegion()).toHaveAttribute(LIVE_REGION_ATTR);
  });

  it("falls back to per-element aria-hidden, which still leaves the live regions exposed", async () => {
    // R12 hypothesis (a): every engine the SPA is built for has `inert`, but
    // an older embed (Qt5 WebEngine is Chromium 87) does not. Remove the
    // reflection `src/test/setup.ts` installs, so this is that engine.
    const reflected = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "inert");
    expect(reflected).toBeDefined();
    Reflect.deleteProperty(HTMLElement.prototype, "inert");
    try {
      render(<Shell />);
      const hiddenBefore = document.querySelectorAll('[aria-hidden="true"]').length;
      await act(async () => useApp.getState().setPrefsOpen(true));
      await act(async () => toast("Saved"));
      expect(document.querySelectorAll("[inert]")).toHaveLength(0);
      expect(document.querySelector(".qzk-main")).toHaveAttribute("aria-hidden", "true");
      // Unlike `inert`, jsdom's accessibility queries DO honour aria-hidden,
      // so here the effect itself is visible: the background is gone from
      // the tree, the dialog and both live regions are not.
      expect(screen.queryByRole("button", { name: "background control" })).toBeNull();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(liveRegion()).toBeInTheDocument();
      expect(document.querySelector(".qzk-toaster")!.closest('[aria-hidden="true"]')).toBeNull();
      // aria-hidden refuses nothing to SCRIPT, which real `inert` does: a
      // window's focus-on-mount or any `.focus()` into the background would
      // land. The fallback's focusin guard sends it back into the dialog.
      const dialog = screen.getByRole("dialog");
      act(() => document.querySelector<HTMLElement>(".qzk-main button")!.focus());
      expect(dialog.contains(document.activeElement)).toBe(true);
      // ...and leaves focus that is not in the background alone.
      const inside = dialog.querySelectorAll<HTMLElement>("button")[1];
      act(() => inside.focus());
      expect(inside).toHaveFocus();

      await act(async () => useApp.getState().setPrefsOpen(false));
      expect(document.querySelectorAll('[aria-hidden="true"]')).toHaveLength(hiddenBefore);
      expect(openModalCount()).toBe(0);
    } finally {
      Object.defineProperty(HTMLElement.prototype, "inert", reflected!);
    }
  });
});
