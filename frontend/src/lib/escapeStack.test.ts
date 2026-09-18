// P3.3 round 3 — the ordered Escape registry itself (findings 1+2+3).
//
// The DOM-layer proofs that a workshop outranks the workspace behind it live
// with the components (ToolWindow.test.tsx, LibraryWorkspace.test.tsx,
// QuickFigureBuilderWorkspace.test.tsx, e2e/specs/workshop-escape-ladder).
// These cases pin the dispatcher's own rules, which those tests exercise but
// cannot isolate: walk order, the one-intent guards, and the deferral that
// lets a bubble consumer keep a key it claimed.

import { act, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pushEscapeSurface, useEscapeSurface, type EscapeLayer } from "./escapeStack";
import { useApp } from "../store/useApp";

const cleanups: (() => void)[] = [];

function register(layer: EscapeLayer, claims: boolean, log: string[], name: string): void {
  cleanups.push(
    pushEscapeSurface(layer, () => {
      log.push(name);
      return claims;
    }),
  );
}

/** Fire Escape and let the deferred walk run. */
async function escape(target: Window | Document | Element = window, init: object = {}): Promise<void> {
  fireEvent.keyDown(target, { key: "Escape", ...init });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  useApp.setState({ cmdkOpen: false });
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe("escapeStack — walk order", () => {
  it("gives the key to the innermost layer first: window, then workspace, then app", async () => {
    const log: string[] = [];
    // Registered in the WRONG order on purpose — the app-level fallback mounts
    // first in the real app, the workspace next, the workshop last.
    register("app", true, log, "app");
    register("workspace", true, log, "workspace");
    register("window", true, log, "window");

    await escape();
    expect(log).toEqual(["window"]);
  });

  it("a surface that declines hands the key down to the one below it", async () => {
    const log: string[] = [];
    register("app", true, log, "app");
    register("workspace", true, log, "workspace");
    register("window", false, log, "window"); // e.g. focus is not inside the frame

    await escape();
    expect(log).toEqual(["window", "workspace"]);
  });

  it("within a layer, the surface that registered last is innermost", async () => {
    const log: string[] = [];
    register("window", true, log, "first");
    register("window", true, log, "second");

    await escape();
    expect(log).toEqual(["second"]);
  });

  it("orders by OPEN order, not push order — a re-rendered surface keeps its place", async () => {
    // Review NIT 6's latent defect, in this module's terms: the handler
    // identity changes on every render (a new closure over fresh props), and
    // that must not promote a surface above one that opened after it.
    const log: string[] = [];
    const outer = renderHook(
      ({ tag }: { tag: string }) => useEscapeSurface("window", () => {
        log.push(tag);
        return true;
      }),
      { initialProps: { tag: "outer-v1" } },
    );
    renderHook(() => useEscapeSurface("window", () => {
      log.push("inner");
      return true;
    }));

    outer.rerender({ tag: "outer-v2" }); // new handler identity, same surface

    await escape();
    expect(log).toEqual(["inner"]); // not ["outer-v2"]
    outer.unmount();
  });

  it("unregisters on unmount, so the surface below gets the next Escape", async () => {
    const log: string[] = [];
    register("workspace", true, log, "workspace");
    const window1 = renderHook(() => useEscapeSurface("window", () => {
      log.push("window");
      return true;
    }));

    await escape();
    window1.unmount();
    await escape();

    expect(log).toEqual(["window", "workspace"]);
  });
});

describe("escapeStack — one keystroke, one intent (review finding 3)", () => {
  it("a HELD Escape runs the walk once, not once per repeat", async () => {
    const handler = vi.fn(() => true);
    cleanups.push(pushEscapeSurface("window", handler));

    await escape(window); // the initial press
    for (let i = 0; i < 11; i++) await escape(window, { repeat: true });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("two Escapes inside one tick arm ONE walk, not two", async () => {
    const handler = vi.fn(() => true);
    cleanups.push(pushEscapeSurface("window", handler));

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "Escape" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("escapeStack — who else owns Escape", () => {
  it("a bubble consumer that claims the key with preventDefault keeps it", async () => {
    // The `usePeakWizard` shape: a window-bubble listener registered AFTER the
    // surface it sits in, which is exactly what registration order cannot fix.
    const handler = vi.fn(() => true);
    cleanups.push(pushEscapeSurface("window", handler));
    const consumer = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.preventDefault();
    };
    window.addEventListener("keydown", consumer);
    try {
      await escape();
      expect(handler).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", consumer);
    }
  });

  it("an Escape that never reaches window-bubble never reaches the walk", async () => {
    // Every dialog/menu that owns Escape does it by stopping propagation
    // (ConfirmDialog on window-capture, ContextMenu on document-bubble, the
    // CommandPalette through React). None of them needs a special case here.
    const handler = vi.fn(() => true);
    cleanups.push(pushEscapeSurface("window", handler));
    const stopper = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.stopPropagation();
    };
    document.addEventListener("keydown", stopper);
    try {
      await escape(document.body);
      expect(handler).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", stopper);
    }
  });

  it("Escape inside a text field belongs to the field", async () => {
    const handler = vi.fn(() => true);
    cleanups.push(pushEscapeSurface("workspace", handler));
    const input = document.createElement("input");
    document.body.appendChild(input);
    try {
      await escape(input);
      expect(handler).not.toHaveBeenCalled();
    } finally {
      input.remove();
    }
  });

  it("an open command palette owns Escape even if focus has drifted", async () => {
    const handler = vi.fn(() => true);
    cleanups.push(pushEscapeSurface("workspace", handler));
    useApp.setState({ cmdkOpen: true });
    await escape();
    expect(handler).not.toHaveBeenCalled();
  });

  it("an open context menu owns Escape (GUI_INTERACTION #9)", async () => {
    const handler = vi.fn(() => true);
    cleanups.push(pushEscapeSurface("workspace", handler));
    const menu = document.createElement("div");
    menu.className = "qzk-ctx";
    document.body.appendChild(menu);
    try {
      await escape();
      expect(handler).not.toHaveBeenCalled();
    } finally {
      menu.remove();
    }
  });
});
