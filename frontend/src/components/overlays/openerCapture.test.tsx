import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useOpenerCapture } from "./openerCapture";

function openFrom(): HTMLElement | null {
  const { result, rerender } = renderHook(({ open }) => useOpenerCapture(open), { initialProps: { open: false } });
  act(() => rerender({ open: true }));
  return result.current.current;
}

describe("useOpenerCapture body fallback", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("names a still-connected last-focused element when focus is on body", () => {
    const btn = document.body.appendChild(document.createElement("button"));
    btn.focus();
    btn.blur(); // focus now on <body>, as after a menu unmounts
    expect(openFrom()).toBe(btn);
  });

  it("keeps the <body> opener when the last-focused element is gone (command palette)", () => {
    // Regression: a detached palette input as opener sent a workshop's first
    // Escape through focusSafeLanding, breaking the Escape ladder (WebKit/Firefox).
    const input = document.body.appendChild(document.createElement("input"));
    input.focus();
    input.remove();
    expect(openFrom()).toBe(document.body);
  });

  it("still names a detached menu item whose trigger is alive", () => {
    const trigger = document.body.appendChild(document.createElement("button"));
    const item = document.body.appendChild(document.createElement("button")) as HTMLElement & { qzMenuReturn?: HTMLElement };
    item.focus();
    item.qzMenuReturn = trigger;
    item.remove();
    expect(openFrom()).toBe(item);
  });
});
