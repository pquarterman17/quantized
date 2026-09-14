// The press recorder behind the Library's drag self-heal (ROUND 6 of the Tiles
// drag/drop review, 2026-09-14). Its consumers — `store/libraryPanel.ts`'s
// `setActiveDrag` and `components/Library/useDetailsDragDrop.ts` — rest on
// three properties tested here: the listener is attached in the CAPTURE phase
// so nothing in the app can hide a press from it; only a dispatch carrying a
// numeric `pointerId` is ever recorded (so `PointerPress.id` is a real number
// downstream and two `undefined`s can never compare equal); and the record is
// the MOST RECENT press, never an accumulation.

import { beforeEach, describe, expect, it } from "vitest";

import { __resetLastPointerPress, lastPointerPress } from "./lastPointerPress";

const press = (pointerId: number, pointerType: string, target: EventTarget = document): void => {
  target.dispatchEvent(
    new PointerEvent("pointerdown", { pointerId, pointerType, bubbles: true, cancelable: true }),
  );
};

describe("lastPointerPress", () => {
  beforeEach(() => {
    __resetLastPointerPress();
  });

  it("reports no press until one is seen", () => {
    expect(lastPointerPress()).toBeNull();
  });

  it("records a press's pointerId and pointerType", () => {
    press(9, "pen");
    expect(lastPointerPress()).toEqual({ id: 9, type: "pen" });
  });

  it("keeps only the most recent press", () => {
    press(9, "pen");
    press(1, "mouse");
    expect(lastPointerPress()).toEqual({ id: 1, type: "mouse" });
  });

  it("ignores a dispatch with no numeric pointerId, leaving the previous record intact", () => {
    press(1, "mouse");
    document.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    expect(lastPointerPress()).toEqual({ id: 1, type: "mouse" });
  });

  it("never records a non-PointerEvent, even as the very first dispatch it sees", () => {
    document.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    expect(lastPointerPress()).toBeNull();
  });

  it("sees a press that a handler further down stops from propagating (capture phase)", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    try {
      press(4, "touch", el);
      expect(lastPointerPress()).toEqual({ id: 4, type: "touch" });
    } finally {
      el.remove();
    }
  });

  // What every test file's `beforeEach` relies on: the reset forgets the
  // record WITHOUT detaching the listener, so presses after it are still seen.
  it("keeps recording after a reset", () => {
    press(1, "mouse");
    __resetLastPointerPress();
    expect(lastPointerPress()).toBeNull();
    press(3, "touch");
    expect(lastPointerPress()).toEqual({ id: 3, type: "touch" });
  });
});
