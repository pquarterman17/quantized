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

// ── ROUND 4 (review of round 3: finding 4 and NITs 5 + 10) ───────────────
describe("escapeStack — the full six-layer ladder (P3.3 round 4)", () => {
  it("ranks menu ▸ gesture ▸ window ▸ workspace ▸ selection ▸ app", async () => {
    // Registered in the order the real app mounts them — bottom first — so
    // nothing but LAYER_RANK can produce the expected walk.
    const log: string[] = [];
    register("app", false, log, "app");
    register("selection", false, log, "selection");
    register("workspace", false, log, "workspace");
    register("window", false, log, "window");
    register("gesture", false, log, "gesture");
    register("menu", false, log, "menu");

    await escape();
    expect(log).toEqual(["menu", "gesture", "window", "workspace", "selection", "app"]);
  });

  it("a Stage selection sits BELOW an open workspace, so one Escape does one thing", async () => {
    const log: string[] = [];
    register("selection", true, log, "selection");
    register("workspace", true, log, "workspace");

    await escape();
    expect(log).toEqual(["workspace"]); // the selection waits its turn
  });
});

describe("escapeStack — a surface that closed mid-walk is skipped (finding 4)", () => {
  it("does not call a handler that unregistered during this same walk", async () => {
    // `walk` iterates a SNAPSHOT of the stack, so a handler that tears down a
    // surface below it (a workspace close that unmounts a Stage selection —
    // the real shape) leaves a stale entry in that snapshot. Without the
    // `stack.includes` skip the stale handler is still invoked: a second
    // action from one keystroke, on a surface that no longer exists.
    const log: string[] = [];
    const below = vi.fn(() => {
      log.push("below");
      return true;
    });
    const unregisterBelow = pushEscapeSurface("selection", below);
    cleanups.push(unregisterBelow);
    cleanups.push(
      pushEscapeSurface("workspace", () => {
        log.push("workspace");
        unregisterBelow(); // closing the workspace unmounts the surface below
        return false; // …and DECLINES, so the walk continues downward
      }),
    );

    await escape();

    expect(log).toEqual(["workspace"]);
    expect(below).not.toHaveBeenCalled();
  });
});

describe("escapeStack — a throwing handler does not eat the key (review NIT 5)", () => {
  it("logs it, and the surface below still gets its turn", async () => {
    // Measured on the round-3 tree: the exception escaped the `setTimeout` as
    // an uncaught error (outside any React error boundary), the surface below
    // never ran, and it recurred on every Escape while the broken surface
    // stayed mounted — Escape was dead for everything underneath it.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const log: string[] = [];
    cleanups.push(
      pushEscapeSurface("workspace", () => {
        log.push("workspace");
        return true;
      }),
    );
    cleanups.push(
      pushEscapeSurface("window", () => {
        throw new Error("boom");
      }),
    );

    await escape();

    expect(log).toEqual(["workspace"]);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe("escapeStack — the deferred defaultPrevented re-read is the only gate (NIT 10)", () => {
  it("a DOCUMENT-bubble consumer that preventDefaults still stops the walk", async () => {
    // The synchronous `defaultPrevented` check in `onKeyDown` was removed as
    // redundant; this is the one case it could ever have caught.
    // `SymbolPalette` claims exactly this way — document-bubble runs before
    // window-bubble, so the flag is already set when the dispatcher arms the
    // walk, and the walk re-reads it before touching a single surface.
    const handler = vi.fn(() => true);
    cleanups.push(pushEscapeSurface("menu", handler));
    const claimer = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.preventDefault();
    };
    document.addEventListener("keydown", claimer);
    try {
      await escape(document.body);
      expect(handler).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", claimer);
    }
  });
});

// ── ROUND 5 — the claim is resolved at KEYDOWN, only the action waits ─────
//
// The defect these pin, measured in Chromium on `region-tool-escape` (1 run in
// 2 at deviceScaleFactor 1.25/2.0): Escape landed with a live Integrate drag,
// Chromium ran the queued `mouseup` 3.4 ms later — ahead of the 0 ms timer —
// and the walk only 25 ms after that. The drag had already committed and
// cleared its canceller, so the `gesture` surface declined and the key fell
// through to the `app` tier, which disarmed the tool: one keystroke, a
// committed result AND a disarmed tool.
describe("escapeStack — a surface cannot lose its claim in the deferral gap", () => {
  it("STOPS when the surface that owned the key at keydown is gone by the walk", async () => {
    // The generic shape of the race: whatever the innermost surface was when
    // the key was pressed, a LOWER layer must not act on that keystroke just
    // because the surface above it went away while the walk was queued.
    const log: string[] = [];
    register("app", true, log, "app");
    const window1 = renderHook(() => useEscapeSurface("window", () => {
      log.push("window");
      return true;
    }));

    fireEvent.keyDown(window, { key: "Escape" });
    window1.unmount(); // the drag ends / the panel unmounts, before the walk
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(log).toEqual([]); // NOT ["app"]
  });

  it("still skips — and walks past — a surface killed DURING the walk (round 4)", async () => {
    // The sibling case, one moment later in time: round 4's finding-4 rule is
    // about a handler that closes a surface beneath it, and that one keeps
    // walking. Pinned next to the case above so the two cannot be merged.
    const log: string[] = [];
    const unregisterMiddle = pushEscapeSurface("workspace", () => {
      log.push("workspace");
      return true;
    });
    cleanups.push(unregisterMiddle);
    register("app", true, log, "app");
    cleanups.push(
      pushEscapeSurface("window", () => {
        log.push("window");
        unregisterMiddle();
        return false;
      }),
    );

    await escape();

    expect(log).toEqual(["window", "app"]);
  });

  it("gives the gesture layer the key SYNCHRONOUSLY, before the walk is armed", async () => {
    // `cancelActiveGesture()` must tear the drag's listeners down before the
    // browser can deliver the `mouseup` that would commit it — which only
    // works if this layer runs inside the keydown listener.
    const log: string[] = [];
    register("app", true, log, "app");
    register("gesture", true, log, "gesture");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(log).toEqual(["gesture"]); // already done, with no macrotask awaited

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(log).toEqual(["gesture"]); // and the claim stopped the walk
  });

  it("a gesture that ends between keydown and the walk cannot disarm the tool", async () => {
    // The measured failure, end to end. `live` is the drag's own state: the
    // handler claims while it is set, and the release clears it.
    let live = true;
    const log: string[] = [];
    register("app", true, log, "app");
    cleanups.push(
      pushEscapeSurface("gesture", () => {
        log.push("gesture");
        if (!live) return false; // nothing to cancel any more
        live = false;
        return true;
      }),
    );

    fireEvent.keyDown(window, { key: "Escape" });
    live = false; // the queued mouseup lands before the timer: drag committed
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(log).toEqual(["gesture"]); // NOT ["gesture", "app"]
  });

  it("an open menu still outranks a live gesture, and the walk still decides", async () => {
    // The synchronous path must not smuggle the gesture past a menu: the scan
    // stops at the first surface that is not gesture-layer, so with a menu
    // open the whole keystroke goes to the deferred walk exactly as before.
    const log: string[] = [];
    register("gesture", true, log, "gesture");
    register("menu", true, log, "menu");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(log).toEqual([]); // nothing ran synchronously

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(log).toEqual(["menu"]);
  });

  it("a claim that landed BEFORE the dispatcher still beats the gesture layer", async () => {
    // `SymbolPalette`'s shape (document-bubble / window-capture): the flag is
    // already set when the keydown listener runs, so the synchronous path is
    // skipped and nothing is cancelled.
    const handler = vi.fn(() => true);
    cleanups.push(pushEscapeSurface("gesture", handler));
    const claimer = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.preventDefault();
    };
    window.addEventListener("keydown", claimer, true);
    try {
      await escape();
      expect(handler).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", claimer, true);
    }
  });
});

// P3.3 round 6 — a synchronous claim consumes the KEY, and only an offered
// surface can swallow it.
describe("escapeStack — a synchronous claim consumes the keystroke", () => {
  it("stops a LATE window-bubble consumer from acting on the same key", async () => {
    // The measured defect: the synchronous `gesture` claim returned without
    // marking the event, so the keystroke carried on down the propagation path
    // un-claimed. `useGlobalShortcuts` registers the `gesture` and `app`
    // surfaces unconditionally at App mount, so the dispatcher's own listener
    // is attached FIRST and every later window-bubble consumer runs after it —
    // `usePeakWizard`'s marker-edit pause (this listener's shape) is the one in
    // the tree. One Escape cancelled the drag AND paused the marker edit.
    const log: string[] = [];
    register("app", true, log, "app");
    register("gesture", true, log, "gesture");
    const lateConsumer = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      log.push("late-bubble-claimant");
    };
    window.addEventListener("keydown", lateConsumer);
    try {
      await escape();
      expect(log).toEqual(["gesture"]); // NOT ["gesture", "late-bubble-claimant"]
    } finally {
      window.removeEventListener("keydown", lateConsumer);
    }
  });

  it("marks the event itself, which is how a later consumer can tell", () => {
    // The mechanism behind the case above, asserted directly: after a
    // synchronous claim `defaultPrevented` read false, so nothing downstream
    // could know the keystroke was already spent.
    cleanups.push(pushEscapeSurface("gesture", () => true));
    const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("does NOT mark a key the gesture layer declined", async () => {
    // The layer declines when nothing is mid-drag, and a decline has to leave
    // the keystroke exactly as it found it — otherwise the deferred walk's own
    // `defaultPrevented` re-read would abort the walk this keydown just armed.
    const log: string[] = [];
    register("app", true, log, "app");
    register("gesture", false, log, "gesture");
    const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(log).toEqual(["gesture", "app"]);
  });
});

describe("escapeStack — only the keydown CLAIMANT can swallow the key by dying", () => {
  it("walks PAST a snapshot entry that was never the claimant and died in the gap", async () => {
    // Round 5 stopped the walk for ANY snapshot entry that was gone by walk
    // time. Measured on that tree: a `ToolWindow` that DECLINES (focus outside
    // its frame) over a workspace that closes itself in the gap swallowed the
    // keystroke and the `app` tier below it never ran — where round 4 gave it
    // the key. The dead entry was never offered anything: the walk only
    // reached it because the window above it declined.
    const log: string[] = [];
    register("app", true, log, "app");
    const unregisterWorkspace = pushEscapeSurface("workspace", () => {
      log.push("workspace");
      return true;
    });
    cleanups.push(unregisterWorkspace);
    register("window", false, log, "window"); // focus is not inside the frame

    fireEvent.keyDown(window, { key: "Escape" });
    unregisterWorkspace(); // closes itself between the keydown and the walk
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(log).toEqual(["window", "app"]); // NOT ["window"]
  });

  it("STILL stops when the CLAIMANT itself dies, with the same stack below it", async () => {
    // The other side of the boundary, one entry along: here the surface that
    // WAS innermost at keydown is the one that goes away, so round 5's rule
    // still holds and nothing below it acts on that keystroke.
    const log: string[] = [];
    register("app", true, log, "app");
    register("workspace", true, log, "workspace");
    const unregisterWindow = pushEscapeSurface("window", () => {
      log.push("window");
      return true;
    });
    cleanups.push(unregisterWindow);

    fireEvent.keyDown(window, { key: "Escape" });
    unregisterWindow(); // the claimant goes away before the walk
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(log).toEqual([]); // NOT ["workspace"]
  });
});
