// The first-ask window of the lazy promise dialogs (bundle diet slice 8,
// review round): between an ask and its body chunk arriving nothing on screen
// is modal. Before the fix, keys reached the page behind -- a second Enter on
// the triggering button asked AGAIN and replaced the first ask's `resolve`, so
// the first promise never settled (`["ask2:false"]` where the parent gave
// `["ask1:false"]`), and an Escape closed the surface BEHIND the dialog, which
// then opened anyway. `usePendingDialogGuard` owns those keys for the window,
// and the stores settle a replaced ask with its cancel value.
//
// The body module is held back by its mock until the test releases it, which
// is exactly the in-flight chunk fetch.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ConfirmDialog, { askConfirm } from "./ConfirmDialog";
import { askParams } from "./ParamDialog";
import { useEscapeSurface } from "../../lib/escapeStack";
import type { ParamValues } from "../../lib/params";
// Warm the body's dependencies (never the body -- it must stay held).
import "../primitives";
import "./useDialogFocus";

const { gate } = vi.hoisted(() => {
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  return { gate: { held, release: () => release() } };
});
vi.mock("./ConfirmDialogBody", async (importOriginal: () => Promise<Record<string, unknown>>) => {
  await gate.held;
  return await importOriginal();
});

/** A key press the way a browser delivers it to the focused element: keydown
 *  (a focused button activates on Enter unless keydown was default-prevented),
 *  then keyup. Dispatched by hand, not through user-event, so the ONLY thing
 *  that can stop the activation is a listener in the app -- which is the
 *  claim under test. */
function press(el: HTMLElement, key: string): void {
  act(() => {
    const down = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    if (el.dispatchEvent(down) && key === "Enter" && el instanceof HTMLButtonElement) el.click();
    el.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
  });
}

/** A surface on the `window` layer behind the dialog, like a ToolWindow. */
function Behind({ onEscape }: { onEscape: () => void }) {
  useEscapeSurface("window", () => {
    onEscape();
    return true;
  });
  return null;
}

describe("the first-ask window of a lazy confirm (chunk in flight)", () => {
  it("owns Escape and Enter until the body mounts, and never loses an ask", async () => {
    const behindEscape = vi.fn();
    const log: string[] = [];
    let n = 0;
    const onDelete = () => {
      const tag = `ask${++n}`;
      void askConfirm("Delete it?", "no undo", "Delete", true).then((v) => log.push(`${tag}:${v}`));
    };
    render(
      <>
        <Behind onEscape={behindEscape} />
        <button type="button" onClick={onDelete}>
          Delete
        </button>
        <ConfirmDialog />
      </>,
    );

    // 1. Escape during the fetch cancels the ASK, not the surface behind it,
    //    and the dialog does not open afterwards.
    const trigger = screen.getByRole("button", { name: "Delete" });
    trigger.focus();
    press(trigger, "Enter");
    press(trigger, "Escape");
    await act(async () => {
      await Promise.resolve();
    });
    expect(log).toEqual(["ask1:false"]);
    expect(behindEscape).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();

    // 2. The reviewer's repro: Enter twice on the focused trigger while the
    //    chunk is still in flight asks ONCE; the second Enter goes nowhere.
    press(trigger, "Enter");
    press(trigger, "Enter");
    expect(n).toBe(2);

    // Release INSIDE act and let the gate's own load chain (import -> preload
    // -> setReady) run to completion there, so the dialog commits before act
    // returns. Waiting outside act left that commit to the scheduler, which
    // missed findByRole's 1 s under a loaded full-suite run (seen twice).
    await act(async () => {
      gate.release();
      await import("./ConfirmDialogBody");
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(await screen.findByRole("dialog")).toHaveAccessibleName("Delete it?");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(log).toEqual(["ask1:false", "ask2:false"]);
    expect(behindEscape).not.toHaveBeenCalled();
  });
});

describe("a replaced ask settles instead of hanging", () => {
  it("confirm: the replaced ask answers false", async () => {
    let first!: Promise<boolean>;
    act(() => {
      first = askConfirm("First?");
      void askConfirm("Second?");
    });
    await expect(first).resolves.toBe(false);
  });

  it("params: the replaced request resolves null", async () => {
    let first!: Promise<ParamValues | null>;
    act(() => {
      first = askParams("First", []);
      void askParams("Second", []);
    });
    await expect(first).resolves.toBeNull();
  });
});
