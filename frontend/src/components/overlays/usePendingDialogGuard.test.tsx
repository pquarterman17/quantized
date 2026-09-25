// usePendingDialogGuard (bundle diet slice 8, review round 2): the claims its
// header makes -- Enter AND Space swallowed on keydown AND keyup, Escape
// cancels the pending ask -- each pinned directly, plus two guards pending at
// once (a shared listener used to be deduped, so the first guard to go
// stripped the other's protection).

import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { usePendingDialogGuard } from "./usePendingDialogGuard";

function Guard({ active, cancel }: { active: boolean; cancel: () => void }) {
  usePendingDialogGuard(active, cancel);
  return null;
}

/** Deliver a key the way a browser activates a focused button: Enter on
 *  keydown, Space on keyup, each unless that event was default-prevented. */
function press(el: HTMLElement, key: string): void {
  act(() => {
    const down = el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    if (down && key === "Enter") el.click();
    const up = el.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
    if (up && key === " ") el.click();
  });
}

function setup(guards: boolean[]) {
  const clicked = vi.fn();
  const cancels = guards.map(() => vi.fn());
  const view = (flags: boolean[]) => (
    <>
      {flags.map((a, i) => (
        <Guard key={i} active={a} cancel={cancels[i]} />
      ))}
      <button type="button" onClick={clicked}>
        Behind
      </button>
    </>
  );
  const r = render(view(guards));
  const button = r.getByRole("button", { name: "Behind" });
  button.focus();
  return { clicked, cancels, button, rerender: (flags: boolean[]) => r.rerender(view(flags)) };
}

describe("usePendingDialogGuard", () => {
  it("swallows Enter (keydown) and Space (keyup) while pending, and releases them after", () => {
    const { clicked, button, rerender } = setup([true]);
    press(button, "Enter");
    press(button, " ");
    expect(clicked).not.toHaveBeenCalled();

    rerender([false]);
    press(button, "Enter");
    press(button, " ");
    expect(clicked).toHaveBeenCalledTimes(2);
  });

  it("Escape cancels the pending ask", () => {
    const { cancels, button } = setup([true]);
    press(button, "Escape");
    expect(cancels[0]).toHaveBeenCalledTimes(1);
  });

  it("keeps protecting while another pending guard goes away", () => {
    const { clicked, button, rerender } = setup([true, true]);
    rerender([true, false]);
    press(button, "Enter");
    press(button, " ");
    expect(clicked).not.toHaveBeenCalled();
  });
});
