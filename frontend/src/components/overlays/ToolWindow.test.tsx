// Tests for GUI_INTERACTION_PLAN #10 (floating workshops recoverable):
// default position from props, persistence across close/reopen (remount),
// the collapse toggle, and the viewport re-clamp on mount. Drag/resize
// POINTER gestures aren't simulated here (jsdom has no real layout, and
// `setPointerCapture` support is unreliable) — the clamp MATH they rely on
// is covered by lib/toolwindow.test.ts; this file covers the store wiring
// and rendered DOM.

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ConfirmDialog, { askConfirm } from "./ConfirmDialog";
import Library from "../Library/Library";
import { appRootFocusProps } from "../../lib/appRoot";
import { useEscapeSurface } from "../../lib/escapeStack";
import { useGlobalShortcuts } from "../../useGlobalShortcuts";
import { scrollOutFocusProps } from "../../lib/scrollOutFocus";
import { pressEscape } from "../../test/pressEscape";
import { useApp } from "../../store/useApp";
import ToolWindow from "./ToolWindow";

function winEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector(".qzk-win");
  if (!el) throw new Error("ToolWindow root not rendered");
  return el as HTMLElement;
}

beforeEach(() => {
  useApp.setState({ toolWindowLayout: {} });
});

describe("ToolWindow default layout", () => {
  it("renders at its default x/y/width props when never persisted", () => {
    const { container } = render(
      <ToolWindow id="t1" title="Test">
        body
      </ToolWindow>,
    );
    const el = winEl(container);
    expect(el.style.left).toBe("120px");
    expect(el.style.top).toBe("90px");
    expect(el.style.width).toBe("360px");
  });

  it("honors explicit x/y/width props", () => {
    const { container } = render(
      <ToolWindow id="t2" title="Test" x={130} y={70} width={480}>
        body
      </ToolWindow>,
    );
    const el = winEl(container);
    expect(el.style.left).toBe("130px");
    expect(el.style.top).toBe("70px");
    expect(el.style.width).toBe("480px");
  });
});

describe("ToolWindow persistence across close/reopen", () => {
  it("restores a previously-set store position instead of the default props", () => {
    useApp.getState().setToolWindowLayout("t3", {
      x: 555,
      y: 222,
      width: 400,
      height: null,
      collapsed: false,
    });
    const { container } = render(
      <ToolWindow id="t3" title="Test" x={120} y={90} width={360}>
        body
      </ToolWindow>,
    );
    const el = winEl(container);
    expect(el.style.left).toBe("555px");
    expect(el.style.top).toBe("222px");
    expect(el.style.width).toBe("400px");
  });

  it("a fresh mount of a DIFFERENT id is unaffected by another window's stored layout", () => {
    useApp.getState().setToolWindowLayout("t4", { x: 555, y: 222, width: 400, height: null, collapsed: false });
    const { container } = render(
      <ToolWindow id="other" title="Test">
        body
      </ToolWindow>,
    );
    const el = winEl(container);
    expect(el.style.left).toBe("120px");
  });

  it("simulated close+reopen (unmount/remount) keeps the SAME position (the pre-#10 regression)", () => {
    const first = render(
      <ToolWindow id="t5" title="Test">
        body
      </ToolWindow>,
    );
    // The store round trip that a real drag-end would perform. Well inside
    // the jsdom default 1024x768 viewport so the mount re-clamp is a no-op —
    // that clamp behavior has its own dedicated test below.
    useApp.getState().setToolWindowLayout("t5", { x: 500, y: 300, width: 360, height: null, collapsed: false });
    first.unmount();
    const second = render(
      <ToolWindow id="t5" title="Test">
        body
      </ToolWindow>,
    );
    const el = winEl(second.container);
    expect(el.style.left).toBe("500px");
    expect(el.style.top).toBe("300px");
  });
});

describe("ToolWindow collapse", () => {
  it("starts expanded (body visible) by default", () => {
    render(
      <ToolWindow id="t6" title="Test">
        <div>panel body</div>
      </ToolWindow>,
    );
    expect(screen.getByText("panel body")).toBeInTheDocument();
  });

  it("the chevron button hides the body and flips the persisted collapsed flag", () => {
    render(
      <ToolWindow id="t7" title="Test">
        <div>panel body</div>
      </ToolWindow>,
    );
    fireEvent.click(screen.getByTitle("Collapse"));
    expect(screen.queryByText("panel body")).not.toBeInTheDocument();
    expect(useApp.getState().toolWindowLayout.t7.collapsed).toBe(true);
  });

  it("double-clicking the title bar also toggles collapse", () => {
    const { container } = render(
      <ToolWindow id="t8" title="Test">
        <div>panel body</div>
      </ToolWindow>,
    );
    const titleBar = container.querySelector(".qzk-win-title");
    if (!titleBar) throw new Error("title bar not rendered");
    fireEvent.doubleClick(titleBar);
    expect(screen.queryByText("panel body")).not.toBeInTheDocument();
    expect(screen.getByTitle("Expand")).toBeInTheDocument();
  });

  it("clicking Expand restores the body without disturbing position/size", () => {
    useApp.getState().setToolWindowLayout("t9", { x: 44, y: 55, width: 333, height: null, collapsed: true });
    const { container } = render(
      <ToolWindow id="t9" title="Test">
        <div>panel body</div>
      </ToolWindow>,
    );
    expect(screen.queryByText("panel body")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Expand"));
    expect(screen.getByText("panel body")).toBeInTheDocument();
    const el = winEl(container);
    expect(el.style.left).toBe("44px");
    expect(el.style.width).toBe("333px");
  });
});

describe("ToolWindow close button", () => {
  it("calls onClose without touching the persisted layout", () => {
    let closed = false;
    render(
      <ToolWindow id="t10" title="Test" onClose={() => (closed = true)}>
        body
      </ToolWindow>,
    );
    fireEvent.click(screen.getByTitle("Close"));
    expect(closed).toBe(true);
  });

  it("omits the close button when onClose is not given", () => {
    render(
      <ToolWindow id="t11" title="Test">
        body
      </ToolWindow>,
    );
    expect(screen.queryByTitle("Close")).not.toBeInTheDocument();
  });
});

describe("ToolWindow viewport re-clamp on mount", () => {
  it("clamps an out-of-bounds stored x back onto the (jsdom) viewport", () => {
    useApp.getState().setToolWindowLayout("t12", {
      x: 999999,
      y: 90,
      width: 360,
      height: null,
      collapsed: false,
    });
    const { container } = render(
      <ToolWindow id="t12" title="Test">
        body
      </ToolWindow>,
    );
    const el = winEl(container);
    const left = parseInt(el.style.left, 10);
    expect(left).toBeLessThan(999999);
    expect(left).toBe(window.innerWidth - 360);
  });
});

describe("ToolWindow resize handle", () => {
  it("renders a resize grip while expanded", () => {
    const { container } = render(
      <ToolWindow id="t13" title="Test">
        body
      </ToolWindow>,
    );
    expect(container.querySelector(".qzk-win-resize")).toBeInTheDocument();
  });

  it("omits the resize grip while collapsed", () => {
    useApp.getState().setToolWindowLayout("t14", { x: 0, y: 0, width: 360, height: null, collapsed: true });
    const { container } = render(
      <ToolWindow id="t14" title="Test">
        body
      </ToolWindow>,
    );
    expect(container.querySelector(".qzk-win-resize")).not.toBeInTheDocument();
  });
});

describe("View-menu reset command reaches a mounted ToolWindow", () => {
  it("resetToolWindowPositions snaps an open, moved window back to its default props", () => {
    // Well inside the jsdom default 1024x768 viewport (see the persistence
    // test above) so the mount re-clamp doesn't also move it.
    useApp.getState().setToolWindowLayout("t15", { x: 400, y: 300, width: 500, height: 400, collapsed: true });
    const { container } = render(
      <ToolWindow id="t15" title="Test" x={120} y={90} width={360}>
        <div>panel body</div>
      </ToolWindow>,
    );
    expect(winEl(container).style.left).toBe("400px");
    // A direct store call (not a user event fireEvent already wraps) — React
    // 18+ auto-batches it, so flush via act() before reading the DOM back.
    act(() => useApp.getState().resetToolWindowPositions());
    const el = winEl(container);
    expect(el.style.left).toBe("120px");
    expect(el.style.top).toBe("90px");
    expect(el.style.width).toBe("360px");
    expect(screen.getByText("panel body")).toBeInTheDocument(); // uncollapsed too
  });
});
// ── ToolWindow: the shared workshop host had no keyboard dismissal ───────
describe("ToolWindow keyboard cancel (P3.3)", () => {
  it("takes focus on open so the panel is immediately keyboard-live", () => {
    const { container } = render(
      <ToolWindow id="t1" title="Find peaks" onClose={() => {}}>
        <button type="button">Run</button>
      </ToolWindow>,
    );
    expect(container.querySelector(".qzk-win")).toHaveFocus();
  });

  it("Escape closes the panel", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ToolWindow id="t2" title="Find peaks" onClose={onClose}>
        <button type="button">Run</button>
      </ToolWindow>,
    );

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape from a control inside the panel also closes it", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ToolWindow id="t3" title="Find peaks" onClose={onClose}>
        <button type="button">Run</button>
      </ToolWindow>,
    );

    screen.getByRole("button", { name: "Run" }).focus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape while TYPING belongs to the field, not the window", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ToolWindow id="t4" title="Find peaks" onClose={onClose}>
        <input aria-label="Threshold" defaultValue="3" />
      </ToolWindow>,
    );

    await user.click(screen.getByLabelText("Threshold"));
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not steal Escape from a panel that already consumed it", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ToolWindow id="t5" title="Region tool" onClose={onClose}>
        {/* Stands in for a workshop that owns Escape for its own object
            (the region tool's in-progress shade, a draw-mode overlay). */}
        <button type="button" onKeyDown={(e) => e.key === "Escape" && e.preventDefault()}>
          Draw
        </button>
      </ToolWindow>,
    );

    screen.getByRole("button", { name: "Draw" }).focus();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a panel with no close action is unaffected by Escape", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ToolWindow id="t6" title="Pinned">
        <button type="button">Run</button>
      </ToolWindow>,
    );
    await user.keyboard("{Escape}");
    expect(container.querySelector(".qzk-win")).toBeInTheDocument();
  });
});

// ── ToolWindow round 2: the pass took focus and never gave it back ───────
// Review finding 1, measured on the round-1 tree: open a workshop from a
// button, press Escape, and `document.activeElement === document.body` —
// where `useGlobalShortcuts`' Delete/Backspace removes the active dataset.
// Before the round-1 focus-on-mount there was no such hole (focus simply
// stayed on the opener), so the pass created it.
describe("ToolWindow focus lifecycle (P3.3 round 2)", () => {
  /** A workshop opened from a button, the way the Library row menu / command
   *  palette do it. `keepOpener: false` is the MENU shape: the control that
   *  opened the panel is gone by the time the panel closes. */
  function OpenerHarness({ keepOpener = true }: { keepOpener?: boolean }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        {/* The Library's own focus-loss landing spot (lib/scrollOutFocus.ts). */}
        <div {...scrollOutFocusProps} data-testid="landing" />
        {(keepOpener || !open) && (
          <button type="button" onClick={() => setOpen(true)}>
            Open Peaks
          </button>
        )}
        {open && (
          <ToolWindow id="peaks" title="Find peaks" onClose={() => setOpen(false)}>
            <button type="button">Run</button>
          </ToolWindow>
        )}
      </>
    );
  }

  it("gives focus back to the opener when the panel closes", async () => {
    const user = userEvent.setup();
    const { container } = render(<OpenerHarness />);
    const opener = screen.getByRole("button", { name: "Open Peaks" });

    await user.click(opener);
    expect(winEl(container)).toHaveFocus(); // the panel took focus…

    await user.keyboard("{Escape}");
    expect(container.querySelector(".qzk-win")).toBeNull();
    expect(opener).toHaveFocus(); // …and gave it back
  });

  it("lands on the shared safe spot, never <body>, when the opener is gone", async () => {
    const user = userEvent.setup();
    const { container } = render(<OpenerHarness keepOpener={false} />);

    await user.click(screen.getByRole("button", { name: "Open Peaks" }));
    expect(screen.queryByRole("button", { name: "Open Peaks" })).toBeNull();

    await user.keyboard("{Escape}");
    expect(container.querySelector(".qzk-win")).toBeNull();
    expect(document.body).not.toHaveFocus();
    expect(screen.getByTestId("landing")).toHaveFocus();
  });

  it("leaves a child's autoFocus alone instead of taking focus onto the frame", () => {
    // Review finding 5: React applies `autoFocus` during the commit and the
    // frame's passive effect ran after it, so round 1 took focus back off any
    // panel that opens straight into a field.
    const { container } = render(
      <ToolWindow id="t16" title="Curve fit" onClose={() => {}}>
        <input aria-label="Start" defaultValue="0" autoFocus />
      </ToolWindow>,
    );
    expect(screen.getByLabelText("Start")).toHaveFocus();
    expect(winEl(container)).not.toHaveFocus();
  });
});

// ── ToolWindow round 2: who actually owns Escape ─────────────────────────
// Review finding 2, measured on the round-1 tree: `onWindowKey` called
// `e.stopPropagation()` on a React synthetic event, which stops the NATIVE
// event at React's root container — so every window-BUBBLE Escape consumer in
// the app (useGlobalShortcuts' plot-tool cancel, the Stage draw/shape/
// annotation edits, usePeakWizard's marker-edit pause) ran ZERO times and the
// `defaultPrevented` guard could never see them. Probe A (bubble listener):
// onClose 1, consumer 0. Probe B (capture listener): onClose 0, consumer 1.
describe("ToolWindow Escape precedence (P3.3 round 2)", () => {
  /** The `usePeakWizard` shape: a window BUBBLE listener owned by the
   *  component that RENDERS the window, so its effect — and therefore its
   *  registration — happens AFTER the window's own. Registration order is
   *  exactly what a "register later" fix cannot control (usePeakWizard
   *  re-registers when the wizard reaches step ②, long after mount), so the
   *  decision to close is re-checked once the dispatch is over instead. */
  function PanelOwningEscape({ onClose, onEscape }: { onClose: () => void; onEscape: () => void }) {
    useEffect(() => {
      const h = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        e.preventDefault(); // "this keystroke was mine" — the repo's convention
        onEscape();
      };
      window.addEventListener("keydown", h);
      return () => window.removeEventListener("keydown", h);
    }, [onEscape]);
    return (
      <ToolWindow id="t17" title="Peak Analyzer" onClose={onClose}>
        <button type="button">Run</button>
      </ToolWindow>
    );
  }

  it("a panel hook that claims Escape keeps it — the window does NOT close", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onEscape = vi.fn();
    render(<PanelOwningEscape onClose={onClose} onEscape={onEscape} />);

    await user.keyboard("{Escape}");

    expect(onEscape).toHaveBeenCalledTimes(1); // the panel's handler ran at all
    expect(onClose).not.toHaveBeenCalled();
  });

  it("an unclaimed Escape still closes the panel, and reaches the window listeners", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const seen = vi.fn();
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") seen();
    };
    window.addEventListener("keydown", h);
    try {
      render(
        <ToolWindow id="t18" title="Find peaks" onClose={onClose}>
          <button type="button">Run</button>
        </ToolWindow>,
      );
      await user.keyboard("{Escape}");
      expect(seen).toHaveBeenCalledTimes(1); // no stopPropagation any more
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", h);
    }
  });

  it("a dialog stacked on the workshop still gets its own Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <>
        <ToolWindow id="t19" title="Find peaks" onClose={onClose}>
          <button type="button">Run</button>
        </ToolWindow>
        <ConfirmDialog />
      </>,
    );
    let result!: Promise<boolean>;
    act(() => {
      result = askConfirm("Remove everything?", "gone forever", "Remove all", true);
    });

    await user.keyboard("{Escape}");

    await expect(result).resolves.toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ── ToolWindow round 3: one keystroke, one close ─────────────────────────
// Review finding 3, measured on the round-2 tree: `closeTimer` was a single
// ref that every keydown OVERWROTE without clearing, and there was no
// `e.repeat` guard. Two Escapes called `onClose` twice (the second after the
// panel unmounted); HOLDING Escape called it twelve times, eleven of them
// post-unmount. Every shipped `onClose` is an idempotent store setter, so
// nothing was corrupted — but nothing pinned it either.
describe("ToolWindow Escape is idempotent (P3.3 round 3)", () => {
  it("a HELD Escape closes the panel exactly once", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <ToolWindow id="t20" title="Find peaks" onClose={onClose}>
        <button type="button">Run</button>
      </ToolWindow>,
    );
    const frame = winEl(container);

    await pressEscape(frame); // the initial press…
    for (let i = 0; i < 11; i++) await pressEscape(frame, { repeat: true }); // …then auto-repeat

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a panel that DOES unmount on close closes exactly once under a held key", async () => {
    // The shipped shape: `onClose` flips the parent's flag and the window goes
    // away. The registry's repeat guard is what makes the burst one close —
    // and the panel is gone before any later keystroke could reach it.
    function Host() {
      const [open, setOpen] = useState(true);
      return open ? (
        <ToolWindow id="t21" title="Find peaks" onClose={() => setOpen(false)}>
          <button type="button">Run</button>
        </ToolWindow>
      ) : null;
    }
    const { container } = render(<Host />);
    const frame = winEl(container);

    await pressEscape(frame);
    for (let i = 0; i < 5; i++) await pressEscape(frame, { repeat: true });

    expect(container.querySelector(".qzk-win")).toBeNull();
  });
});

// ── ROUND 4, review finding 1: a DECLINED close keeps the key ────────────
// Not every `onClose` unmounts the window. `usePageLifecycle.requestClose`
// asks "Close without saving?" for a saved page with unsaved edits and leaves
// the panel mounted when the user says no; `PackProjectPanel` stays put by
// design while packing or cancelling. Round 3's per-mount `closed` ref latched
// on the FIRST Escape and was never reset, so for those panels every later
// Escape was dead — and because the guard DECLINED rather than doing nothing,
// the walk fell through and the workspace behind the focused panel closed
// instead. Measured on the round-3 tree: Escape ① → onClose×1; Escape ② →
// onClose×1 (unchanged) and the workspace below closed.
describe("ToolWindow when onClose does not unmount it (P3.3 round 4)", () => {
  function DeclinedCloseHarness({ onWorkspaceClose }: { onWorkspaceClose: () => void }) {
    // A `workspace`-layer surface behind the panel — what Tiles / the Quick
    // Figure Builder register. It must never see these keystrokes.
    useEscapeSurface("workspace", () => {
      onWorkspaceClose();
      return true;
    });
    return null;
  }

  it("claims Escape every time, and the workspace behind it never sees the key", async () => {
    const onClose = vi.fn(); // the declined confirm: the panel stays mounted
    const onWorkspaceClose = vi.fn();
    const { container } = render(
      <>
        <DeclinedCloseHarness onWorkspaceClose={onWorkspaceClose} />
        <ToolWindow id="t22" title="Figure page" onClose={onClose}>
          <button type="button">Save</button>
        </ToolWindow>
      </>,
    );
    const frame = winEl(container);

    await pressEscape(frame);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onWorkspaceClose).not.toHaveBeenCalled();

    // A LATER, separate keypress is a second intent: the confirm reappears.
    await pressEscape(frame);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onWorkspaceClose).not.toHaveBeenCalled();
    expect(container.querySelector(".qzk-win")).not.toBeNull();
  });
});

// ── ROUND 4, review finding 3: an IDLE gadget is not innermost ───────────
// The module header and the plan both state the invariant flatly ("the
// innermost open surface claims Escape"). Round 3 left the idle-armed
// quick-fit tier claiming inline with `preventDefault()`, so it was false:
// measured with a real focused `ToolWindow` over a committed ROI, Escape
// cleared the ROI and left the window open (windowClosed=0, qfitRoi=null).
// A LIVE drag genuinely is innermost and still outranks everything; a
// committed ROI sitting behind a focused window is Stage selection state.
describe("ToolWindow vs an idle quick-fit ROI (P3.3 round 4)", () => {
  function WindowOverIdleRoi() {
    const [open, setOpen] = useState(true);
    useGlobalShortcuts();
    return open ? (
      <ToolWindow id="t23" title="Find peaks" onClose={() => setOpen(false)}>
        <button type="button">Run</button>
      </ToolWindow>
    ) : null;
  }

  it("the focused window closes first; the committed ROI survives until the next Escape", async () => {
    useApp.setState({ plotTool: "qfit", qfitRoi: [1, 2], gadgetCursors: null });
    const { container } = render(<WindowOverIdleRoi />);
    const frame = winEl(container);

    await pressEscape(frame);
    expect(container.querySelector(".qzk-win")).toBeNull(); // the window went…
    expect(useApp.getState().qfitRoi).toEqual([1, 2]); // …and the ROI stayed

    await pressEscape(document.activeElement ?? document);
    expect(useApp.getState().qfitRoi).toBeNull();
    expect(useApp.getState().plotTool).toBe("qfit"); // still armed for a retry
  });
});

// ── The safe landing always exists (P3.3 round 3, review finding 4) ──────
// `focusSafeLanding()` aimed only at `[data-scroll-out-focus]`, which just the
// three VIRTUALIZED Library renderers put in the DOM. With zero rows the
// Library takes its flat branch and renders none — its own comment calls that
// "the most common launch state" — so `?.focus()` silently did nothing and the
// user landed on `<body>`, the documented Delete/Backspace data-loss spot,
// while the commit body, the plan and the test name all said "never <body>".
// The shell root is the second choice and always exists.
describe("ToolWindow safe landing with no Library container (P3.3 round 3)", () => {
  function ZeroRowHarness() {
    const [open, setOpen] = useState(false);
    return (
      <div {...appRootFocusProps} data-testid="app-root">
        {/* The real Library, in the state it launches in: no datasets, so the
            flat branch renders and NO focus-loss container exists. */}
        <Library viewMode="tree" onViewModeChange={() => {}} />
        {!open && (
          <button type="button" onClick={() => setOpen(true)}>
            Open Peaks
          </button>
        )}
        {open && (
          <ToolWindow id="zero-rows" title="Find peaks" onClose={() => setOpen(false)}>
            <button type="button">Run</button>
          </ToolWindow>
        )}
      </div>
    );
  }

  it("lands on the app root when the Library renders no focus-loss container", async () => {
    const user = userEvent.setup();
    useApp.setState({ datasets: [], folders: [], workbooks: [] });
    render(<ZeroRowHarness />);
    // The premise, asserted rather than assumed.
    expect(document.querySelector("[data-scroll-out-focus]")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open Peaks" }));
    expect(screen.queryByRole("button", { name: "Open Peaks" })).toBeNull(); // opener gone

    await user.keyboard("{Escape}");

    expect(document.body).not.toHaveFocus();
    expect(screen.getByTestId("app-root")).toHaveFocus();
  });
});
