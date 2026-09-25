// R12 hypothesis (b) — the DOM-mutation gap. The first cut of R12 walked the
// background only when the modal STACK changed, so anything that mounted
// while a dialog was already open (a window, a body-level portal, the toast
// stack) stayed live until the next stack change. lib/modalInert.ts now keeps
// a MutationObserver attached while a dialog is open; these cases pin what it
// must and must not do:
//   * a new background node goes inert (or is covered by an inert ancestor,
//     at the cost of NO re-walk);
//   * a new live region stays announceable, even one mounted under an
//     already-inert ancestor;
//   * a dialog mounting over another — the slice-8 lazy body resolving over
//     Preferences — is never judged as background, not even transiently;
//   * a dialog that re-renders into a different root element stays modal;
//   * a popover the dialog itself summons (the symbol palette) belongs to it.
// Where the attribute lands is all jsdom can show (see modalInert.test.tsx).

import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";

import ConfirmDialog, { askConfirm } from "./ConfirmDialog";
import PreferencesDialog from "./PreferencesDialog";
import Toaster from "./Toaster";
import { useDialogFocus } from "./useDialogFocus";
import StatusBar from "../Shell/StatusBar";
import SymbolPalette from "../primitives/SymbolPalette";
import { MODAL_LAYER_ATTR, openModalCount } from "../../lib/modalInert";
import { HEALTHY } from "../../lib/autosaveGenerations";
import { lazyRegion } from "../../lib/lazyRegion";
import { reportAutosaveHealth } from "../../store/autosaveStatus";
import { useApp } from "../../store/useApp";
import { useToasts } from "../../store/toasts";
// Warm the lazy confirm body's module graph so its dynamic import below
// waits on nothing but the gate (a cold transform can eat findByRole's 1 s).
import "./ConfirmDialogBody";

/** Test-only switches for things that mount while a dialog is open. */
const useLate = create(() => ({ sibling: false, portal: false, palette: false, swap: false, probe: false, failed: false }));

/** A lazily-loaded dialog whose chunk fails (UX-003): what AppOverlays shows
 *  when e.g. Help is opened over Preferences and its chunk cannot load. The
 *  dialog never mounts, so it never becomes the active modal — its boundary's
 *  alert lands in the background instead. */
const FailingDialog = lazyRegion<object>(
  () => Promise.reject<{ default: () => null }>(new Error("chunk fetch failed")),
  "Help dialog",
);
function LateFail() {
  const on = useLate((s) => s.failed);
  return on ? <FailingDialog /> : null;
}

function LateSibling() {
  const on = useLate((s) => s.sibling);
  return on ? <div className="late-window"><button type="button">late control</button></div> : null;
}
function LatePortal() {
  const on = useLate((s) => s.portal);
  return on ? createPortal(<div className="late-portal"><button type="button">portal control</button></div>, document.body) : null;
}

/** A dialog that, like QuickPlotWithDialog, re-renders into a DIFFERENT root
 *  element while it stays open. */
function SwappingDialog() {
  const open = useLate((s) => s.probe);
  const swap = useLate((s) => s.swap);
  const palette = useLate((s) => s.palette);
  const ref = useRef<HTMLDivElement | null>(null);
  useDialogFocus(ref, open);
  if (!open) return null;
  return (
    <div className="qz-overlay-backdrop probe-backdrop">
      {swap ? (
        <section role="dialog" aria-label="probe B" ref={ref} tabIndex={-1}><button type="button">b</button></section>
      ) : (
        <div role="dialog" aria-label="probe A" ref={ref} tabIndex={-1}><button type="button">a</button></div>
      )}
      {palette && <SymbolPalette x={0} y={0} onInsert={() => {}} onClose={() => {}} />}
    </div>
  );
}

function Shell() {
  return (
    <div className="qzk-app">
      <div className="qzk-main">
        <button type="button">background control</button>
      </div>
      <StatusBar />
      <LateSibling />
      <LatePortal />
      <LateFail />
      <PreferencesDialog />
      <SwappingDialog />
      <ConfirmDialog />
      <Toaster />
    </div>
  );
}

const inertAncestor = (el: Element | null): Element | null => el?.closest("[inert]") ?? null;
const reset = () => {
  useApp.getState().setPrefsOpen(false);
  useLate.setState({ sibling: false, portal: false, palette: false, swap: false, probe: false, failed: false });
  useToasts.setState({ toasts: [] });
  reportAutosaveHealth(HEALTHY);
};
beforeEach(reset);
afterEach(reset);

/** Every `inert` attribute write under `root`, while `run` executes. */
async function inertWrites(run: () => Promise<void>): Promise<MutationRecord[]> {
  const records: MutationRecord[] = [];
  const mo = new MutationObserver((r) => records.push(...r));
  mo.observe(document.body, { attributes: true, attributeFilter: ["inert"], attributeOldValue: true, subtree: true });
  await run();
  records.push(...mo.takeRecords());
  mo.disconnect();
  return records;
}

describe("R12 (b) — background nodes that mount while a dialog is open", () => {
  it("a window mounting beside the dialog goes inert", async () => {
    render(<Shell />);
    await act(async () => useApp.getState().setPrefsOpen(true));
    await act(async () => useLate.setState({ sibling: true }));
    expect(screen.getByText("late control").closest(".late-window")).toHaveAttribute("inert");
    await act(async () => useApp.getState().setPrefsOpen(false));
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
  });

  it("a <body>-level portal mounting while the dialog is open goes inert", async () => {
    render(<Shell />);
    await act(async () => useApp.getState().setPrefsOpen(true));
    await act(async () => useLate.setState({ portal: true }));
    expect(document.querySelector(".late-portal")).toHaveAttribute("inert");
    await act(async () => useApp.getState().setPrefsOpen(false));
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
  });

  it("a node inside an already-inert subtree is covered by inheritance, with no re-walk", async () => {
    render(<Shell />);
    await act(async () => useApp.getState().setPrefsOpen(true));
    const main = document.querySelector(".qzk-main")!;
    const writes = await inertWrites(async () => {
      await act(async () => {
        for (let i = 0; i < 50; i++) main.appendChild(document.createElement("div"));
      });
    });
    // A re-walk lifts and re-sets every mark, so zero `inert` writes is the
    // proof the observer only did its ancestor check.
    expect(writes).toHaveLength(0);
    expect(inertAncestor(main.lastElementChild)).toBe(main);
  });
});

describe("R12 (b) — live regions that mount while a dialog is open", () => {
  it("the autosave-failure alert raised meanwhile stays out of the inert background", async () => {
    render(<Shell />);
    await act(async () => useApp.getState().setPrefsOpen(true));
    await act(async () => reportAutosaveHealth({ savedAt: null, error: "disk full", count: 0 }));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("autosave failing");
    expect(inertAncestor(alert)).toBeNull();
    // The rest of the footer is still inert: the exemption is the alert alone.
    expect(inertAncestor(document.querySelector(".qzk-statusbar .qzk-conn"))).not.toBeNull();
  });

  it("a live region mounting under an inert ancestor gets the descent, not the ancestor's inert", async () => {
    render(<Shell />);
    await act(async () => useApp.getState().setPrefsOpen(true));
    const main = document.querySelector(".qzk-main")!;
    expect(main).toHaveAttribute("inert");
    const region = document.createElement("div");
    region.setAttribute("data-live-region", "");
    await act(async () => {
      main.appendChild(region);
    });
    expect(inertAncestor(region)).toBeNull();
    expect(screen.getByText("background control")).toHaveAttribute("inert");
  });
});

describe("R12 (b) — a lazy dialog that fails to load under an open dialog", () => {
  it("its load-failure alert is announced; its Retry stays inert with the background", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Shell />);
    await act(async () => useApp.getState().setPrefsOpen(true));
    await act(async () => useLate.setState({ failed: true }));
    const alert = await screen.findByRole("alert");
    quiet.mockRestore();
    expect(alert).toHaveTextContent("Help dialog failed to load.");
    // Not inside any dialog (the failed one never mounted), so it is
    // background: the text is exempt and stays in the accessibility tree...
    expect(alert.closest("[role='dialog']")).toBeNull();
    const message = screen.getByText(/Help dialog failed to load/);
    expect(message.tagName).toBe("SPAN");
    expect(inertAncestor(message)).toBeNull();
    // ...while the Retry is inert until Preferences closes, like any other
    // background control.
    expect(inertAncestor(screen.getByText("↻ Retry"))).not.toBeNull();
    await act(async () => useApp.getState().setPrefsOpen(false));
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
  });
});

describe("R12 (b) — dialogs that mount or change root while another is open", () => {
  it("a lazy confirm body resolving over Preferences is never marked inert, even transiently", async () => {
    render(<Shell />);
    await act(async () => useApp.getState().setPrefsOpen(true));
    const prefs = screen.getByRole("dialog");
    let answer!: Promise<boolean>;
    const writes = await inertWrites(async () => {
      act(() => {
        answer = askConfirm("Delete it?");
      });
      // The body's chunk is fetched now, after the ask: this is the mount.
      await screen.findByRole("dialog", { name: "Delete it?" });
    });
    const confirm = screen.getByRole("dialog", { name: "Delete it?" });
    const confirmBackdrop = confirm.closest(".qz-overlay-backdrop")!;
    const setOnConfirm = writes.filter((r) => r.oldValue === null && confirmBackdrop.contains(r.target as Node));
    expect(setOnConfirm).toEqual([]);
    expect(inertAncestor(confirm)).toBeNull();
    // ...and it is the one active modal: Preferences went inert under it.
    expect(inertAncestor(prefs)).not.toBeNull();
    await act(async () => screen.getByRole("button", { name: "Cancel" }).click());
    await expect(answer).resolves.toBe(false);
    expect(inertAncestor(prefs)).toBeNull();
  });

  it("a dialog that re-renders into a different root element stays the modal", async () => {
    render(<Shell />);
    await act(async () => useLate.setState({ probe: true }));
    expect(document.querySelector(".qzk-main")).toHaveAttribute("inert");
    await act(async () => useLate.setState({ swap: true }));
    const b = screen.getByRole("dialog", { name: "probe B" });
    expect(inertAncestor(b)).toBeNull();
    expect(document.querySelector(".qzk-main")).toHaveAttribute("inert");
    await act(async () => useLate.setState({ probe: false }));
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
    expect(openModalCount()).toBe(0);
  });
});

describe("R12 (b) — a popover the dialog summons belongs to the dialog", () => {
  const palette = () => document.querySelector(`[${MODAL_LAYER_ATTR}]`);

  it("the symbol palette opened from a dialog is live; under a stacked dialog it is not", async () => {
    render(<Shell />);
    await act(async () => useLate.setState({ probe: true }));
    await act(async () => useLate.setState({ palette: true }));
    // Portaled to <body>, i.e. a sibling off the dialog's path — exactly what
    // the walk would inert if the layer were not owned by the dialog.
    expect(palette()?.parentElement).toBe(document.body);
    expect(inertAncestor(palette())).toBeNull();

    // A confirmation asked from the dialog stacks over it (its body mounts
    // fresh per ask, so it is the topmost by the trap's mount order).
    let answer!: Promise<boolean>;
    act(() => {
      answer = askConfirm("Discard label?");
    });
    await screen.findByRole("dialog", { name: "Discard label?" });
    expect(palette()).toHaveAttribute("inert");
    await act(async () => screen.getByRole("button", { name: "Cancel" }).click());
    await expect(answer).resolves.toBe(false);
    expect(inertAncestor(palette())).toBeNull();
  });

  it("a palette arriving in the SAME mutation batch as a background node is still the dialog's", async () => {
    render(<Shell />);
    await act(async () => useLate.setState({ probe: true }));
    // One commit: a window (earlier in the tree, so its record comes first
    // and already calls for a re-walk) and the palette together.
    await act(async () => useLate.setState({ sibling: true, palette: true }));
    expect(screen.getByText("late control").closest(".late-window")).toHaveAttribute("inert");
    expect(inertAncestor(palette())).toBeNull();
  });

  it("a palette that predates the dialog is background", async () => {
    render(
      <>
        <Shell />
        <SymbolPalette x={0} y={0} onInsert={() => {}} onClose={() => {}} />
      </>,
    );
    await act(async () => useApp.getState().setPrefsOpen(true));
    expect(palette()).toHaveAttribute("inert");
  });
});
