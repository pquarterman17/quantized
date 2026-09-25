// R12 hypothesis (c) — release on ABNORMAL unmount — and the stacked lazy
// dialogs of bundle diet slice 8.
//
// A leaked `inert` is the worst failure this design has: the whole app stops
// taking focus and clicks, permanently, with nothing on screen to explain it.
// The registration is a layout effect whose cleanup lifts the walk, so every
// path React has for tearing a dialog down must run that cleanup. Pinned here:
// an error boundary catching a render throw and an effect throw, an uncaught
// throw that unmounts the root, StrictMode's double mount, and the UX-003
// load-failure path of the lazy confirm — each ends with NO `inert` in the
// document and an empty registry.
//
// The body module is controlled by the hoisted `chunk` switch below: `fail`
// is a failed chunk fetch, `hold` an in-flight one, `pass` a loaded one. The
// cases run in file order (fail -> hold -> pass), which is also the order a
// real session can meet them in.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { Component, StrictMode, useEffect, useRef, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { create } from "zustand";

import ConfirmDialog, { askConfirm } from "./ConfirmDialog";
import PreferencesDialog from "./PreferencesDialog";
import Toaster from "./Toaster";
import { useDialogFocus } from "./useDialogFocus";
import { openModalCount } from "../../lib/modalInert";
import { useApp } from "../../store/useApp";
import { useToasts } from "../../store/toasts";
// Warm the body's dependencies (never the body: its mock must run on the
// gate's own import()).
import "../primitives";
import "../../lib/escapeStack";

const { chunk } = vi.hoisted(() => {
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  return { chunk: { mode: "fail" as "fail" | "hold" | "pass", held, release: () => release() } };
});
vi.mock("./ConfirmDialogBody", async (importOriginal: () => Promise<Record<string, unknown>>) => {
  if (chunk.mode === "fail") throw new Error("chunk fetch failed");
  if (chunk.mode === "hold") await chunk.held;
  return await importOriginal();
});

const useProbe = create(() => ({ open: false, boom: "" as "" | "render" | "effect" }));

/** A dialog that throws on demand, AFTER it has registered as the modal. */
function ThrowingDialog() {
  const open = useProbe((s) => s.open);
  const boom = useProbe((s) => s.boom);
  const ref = useRef<HTMLDivElement | null>(null);
  useDialogFocus(ref, open);
  useEffect(() => {
    if (boom === "effect") throw new Error("effect boom");
  }, [boom]);
  if (boom === "render") throw new Error("render boom");
  if (!open) return null;
  return (
    <div className="qz-overlay-backdrop">
      <div role="dialog" aria-label="probe" ref={ref} tabIndex={-1}>
        <button type="button">inside</button>
      </div>
    </div>
  );
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p role="alert">dialog crashed</p> : this.props.children;
  }
}

function Shell({ children }: { children?: ReactNode }) {
  return (
    <div className="qzk-app">
      <div className="qzk-main">
        <button type="button">background control</button>
      </div>
      {children}
      <Toaster />
    </div>
  );
}

const inertAncestor = (el: Element | null): Element | null => el?.closest("[inert]") ?? null;
const nothingInert = () => {
  expect(document.querySelectorAll("[inert]")).toHaveLength(0);
  expect(openModalCount()).toBe(0);
};

let errorSpy: MockInstance;
beforeEach(() => {
  // React logs caught and uncaught render errors; the throws are the point.
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  useProbe.setState({ open: false, boom: "" });
  useApp.getState().setPrefsOpen(false);
  useToasts.setState({ toasts: [] });
});
afterEach(() => {
  errorSpy.mockRestore();
  useApp.getState().setPrefsOpen(false);
});

describe("R12 (c) — a dialog torn down abnormally never leaves the app inert", () => {
  it("an error boundary catching a render throw inside the open dialog", async () => {
    render(<Shell><Boundary><ThrowingDialog /></Boundary></Shell>);
    await act(async () => useProbe.setState({ open: true }));
    expect(document.querySelector(".qzk-main")).toHaveAttribute("inert");
    await act(async () => useProbe.setState({ boom: "render" }));
    expect(screen.getByRole("alert")).toHaveTextContent("dialog crashed");
    nothingInert();
  });

  it("an error boundary catching an effect throw after the dialog registered", async () => {
    render(<Shell><Boundary><ThrowingDialog /></Boundary></Shell>);
    await act(async () => useProbe.setState({ open: true }));
    expect(openModalCount()).toBe(1);
    await act(async () => useProbe.setState({ boom: "effect" }));
    expect(screen.getByRole("alert")).toHaveTextContent("dialog crashed");
    nothingInert();
  });

  it("an uncaught throw that unmounts the whole root", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    const uncaught = vi.fn();
    const root = createRoot(host, { onUncaughtError: uncaught });
    await act(async () => root.render(<Shell><ThrowingDialog /></Shell>));
    await act(async () => useProbe.setState({ open: true }));
    expect(host.querySelector(".qzk-main")).toHaveAttribute("inert");
    // Under `act` React re-throws the uncaught error to the caller (outside
    // it, `onUncaughtError` would get it); either way the root is gone.
    await expect(act(async () => useProbe.setState({ boom: "render" }))).rejects.toThrow("render boom");
    expect(host.childElementCount).toBe(0); // React 19 unmounted the root
    nothingInert();
    root.unmount();
    host.remove();
  });

  it("StrictMode's double mount registers once and releases fully", async () => {
    render(<StrictMode><Shell><ThrowingDialog /></Shell></StrictMode>);
    await act(async () => useProbe.setState({ open: true }));
    expect(openModalCount()).toBe(1);
    expect(document.querySelector(".qzk-main")).toHaveAttribute("inert");
    expect(inertAncestor(screen.getByRole("dialog"))).toBeNull();
    await act(async () => useProbe.setState({ open: false }));
    nothingInert();
  });
});

/** Preferences open with focus on a control INSIDE it — the opener of
 *  whatever stacks on top. */
async function prefsWithInnerOpener(): Promise<{ prefs: HTMLElement; opener: HTMLElement }> {
  await act(async () => useApp.getState().setPrefsOpen(true));
  const prefs = screen.getByRole("dialog");
  const opener = prefs.querySelector<HTMLElement>("button")!;
  act(() => opener.focus());
  return { prefs, opener };
}

describe("R12 — a lazy confirm stacked over Preferences", () => {
  it("load failure (UX-003): Preferences stays the one active modal, the toast is exempt, nothing leaks", async () => {
    chunk.mode = "fail";
    render(<Shell><PreferencesDialog /><ConfirmDialog /></Shell>);
    const { prefs, opener } = await prefsWithInnerOpener();
    let answer!: Promise<boolean>;
    act(() => {
      answer = askConfirm("Delete it?");
    });
    await expect(answer).resolves.toBe(false);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getAllByRole("dialog")).toEqual([prefs]);
    expect(inertAncestor(prefs)).toBeNull();
    expect(openModalCount()).toBe(1);
    expect(document.querySelector(".qzk-main")).toHaveAttribute("inert");
    const toaster = document.querySelector(".qzk-toaster")!;
    expect(toaster).toHaveTextContent("failed to load");
    expect(inertAncestor(toaster)).toBeNull();
    expect(opener).toHaveFocus();
    await act(async () => useApp.getState().setPrefsOpen(false));
    nothingInert();
  });

  it("chunk in flight: Preferences stays active under the pending guard; once the body mounts it is the one modal, and closing it hands Preferences back its focus", async () => {
    chunk.mode = "hold";
    render(<Shell><PreferencesDialog /><ConfirmDialog /></Shell>);
    const { prefs, opener } = await prefsWithInnerOpener();

    // 1. Asked, chunk in flight: nothing new is modal yet. Preferences keeps
    //    the walk and the focus; the pending guard owns Escape and cancels.
    let first!: Promise<boolean>;
    act(() => {
      first = askConfirm("Delete it?");
    });
    expect(openModalCount()).toBe(1);
    expect(inertAncestor(prefs)).toBeNull();
    expect(opener).toHaveFocus();
    fireEvent.keyDown(opener, { key: "Escape" });
    await expect(first).resolves.toBe(false);
    expect(screen.getAllByRole("dialog")).toEqual([prefs]);
    expect(inertAncestor(prefs)).toBeNull();
    expect(opener).toHaveFocus();

    // 2. Ask again and let the chunk land: the body is the active modal and
    //    Preferences goes inert beneath it.
    let second!: Promise<boolean>;
    act(() => {
      second = askConfirm("Delete it?");
    });
    await act(async () => {
      chunk.mode = "pass";
      chunk.release();
      await import("./ConfirmDialogBody");
      await new Promise((r) => setTimeout(r, 0));
    });
    const confirm = await screen.findByRole("dialog", { name: "Delete it?" });
    expect(inertAncestor(confirm)).toBeNull();
    expect(inertAncestor(prefs)).not.toBeNull();
    expect(openModalCount()).toBe(2);

    // 3. Cancel: Preferences is interactive again and focus is back on the
    //    control inside it that opened the ask; the background stays inert.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(second).resolves.toBe(false);
    await act(async () => {});
    expect(inertAncestor(prefs)).toBeNull();
    expect(opener).toHaveFocus();
    expect(document.querySelector(".qzk-main")).toHaveAttribute("inert");
    await act(async () => useApp.getState().setPrefsOpen(false));
    nothingInert();
  });
});
