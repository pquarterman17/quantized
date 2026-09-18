// Adapted from fermiviewer frontend/src/components/overlays/ToolWindow.tsx.
// Draggable floating workshop window. GUI_INTERACTION_PLAN #10 ("floating
// workshops recoverable") lifted its geometry (position/size/collapsed) out
// of local `useState` into store/toolwindows.ts, keyed by the now-required
// `id` prop — a window survives close/reopen, round-trips through the .dwk
// workspace, and the View-menu "Reset window positions" command (commands/
// uiCommands.ts) can reach every open-or-ever-opened window from one place.
// Content/open-flag ownership still lives entirely in each workshop's own
// store field — only geometry moved here. Uses the kit's qzk-win* frame
// (shell.css).
//
// Recoverability (#10 item 1): the ENTIRE title bar — not just the top-left
// corner — is clamped inside the viewport on drag end and on every window
// resize (a monitor unplug is the classic loss scenario), so a window can
// never end up with its grab handle unreachable.

import { useEffect, useRef, useState, type ReactNode } from "react";

import { useEscapeSurface } from "../../lib/escapeStack";
import {
  clampToolWindowPos,
  defaultToolWindowLayout,
  MIN_HEIGHT,
  MIN_WIDTH,
  TITLE_BAR_HEIGHT,
} from "../../lib/toolwindow";
import { workshopHelpTopic } from "../../lib/workshopHelp";
import { openHelpTopic } from "../../store/help";
import { useApp } from "../../store/useApp";
import { useOpenerRestore } from "./useDialogFocus";

let zTop = 0;

export default function ToolWindow({
  id,
  title,
  x = 120,
  y = 90,
  width = 360,
  onClose,
  helpTopic,
  children,
}: {
  /** Stable identity for the persisted-layout registry (store/toolwindows.ts)
   *  — e.g. "baseline", "curvefit", "report". Must be unique across every
   *  concurrently-mountable ToolWindow (most workshops mount at most one
   *  instance at a time, so their own name is a natural id). */
  id: string;
  title: ReactNode;
  x?: number;
  y?: number;
  width?: number;
  onClose?: () => void;
  /** P3.1 contextual help: when set, the title bar carries a `?` that opens
   *  Help already filtered to this string — the `Card` `helpTopic` affordance
   *  lifted to the panel level, because the complex workshops render no Card
   *  to hang one on. Pass the workshop's own command label (e.g. "Find peaks")
   *  so the search lands on that command's shared one-sentence description
   *  rather than a parallel catalog. */
  helpTopic?: string;
  children: ReactNode;
}) {
  const stored = useApp((s) => s.toolWindowLayout[id]);
  const setLayout = useApp((s) => s.setToolWindowLayout);
  const toggleCollapsed = useApp((s) => s.toggleToolWindowCollapsed);
  const fallback = defaultToolWindowLayout(x, y, width);
  const layout = stored ?? fallback;
  // P3.1: registry-driven by default (lib/workshopHelp.ts) so no panel needs
  // its own edit; an explicit `helpTopic` still wins, including for a window
  // with no registry entry.
  const topic = helpTopic ?? workshopHelpTopic(id);

  const [z, setZ] = useState(() => ++zTop);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizeRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const winRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLDivElement | null>(null);

  const clampNow = (nx: number, ny: number, w: number) => {
    const th = titleRef.current?.offsetHeight ?? TITLE_BAR_HEIGHT;
    return clampToolWindowPos(nx, ny, w, th, { width: window.innerWidth, height: window.innerHeight });
  };

  // Re-clamp on viewport resize (monitor unplug — the classic loss scenario)
  // and once on mount (covers a window whose position predates a later
  // browser/monitor resize; a freshly-restored .dwk is already clamped by
  // lib/workspace.ts's sanitizeToolWindowLayout, but this stays correct even
  // for a window that never went through that path). Reads/writes the store
  // directly (not the `layout` closure) so it always acts on the latest value.
  useEffect(() => {
    const reclamp = () => {
      const current = useApp.getState().toolWindowLayout[id] ?? fallback;
      const clamped = clampNow(current.x, current.y, current.width);
      if (clamped.x !== current.x || clamped.y !== current.y) {
        setLayout(id, { ...current, ...clamped });
      }
    };
    reclamp();
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Give focus back when the panel closes (round 2, review finding 1). The
  // frame takes focus on mount (below); taking it without returning it is the
  // exact regression `useDialogFocus` exists to prevent — Escape-closing a
  // workshop dropped the user on `<body>`, where `useGlobalShortcuts`'
  // Delete/Backspace removes the active dataset.
  // Same render-time opener latch as the dialogs, so the Library row or menu
  // item the workshop was opened from gets focus back. `closeNow` moves focus
  // BEFORE the panel goes away (lib/focusGuard.ts's `removeRowSafely`
  // pattern) — the hook's unmount cleanup is a later flush, and until it runs
  // focus sits on <body>; it stays as the backstop for closes that do not
  // come through this component.
  const restoreOpener = useOpenerRestore(winRef, true);
  const closeNow = () => {
    restoreOpener();
    onClose?.();
  };

  // P3.3 "cancel": until this landed, NO workshop could be dismissed from the
  // keyboard — the only close affordance in the whole family of 48 panels was
  // the title bar's ✕, reachable only by tabbing to it. The fix belongs here,
  // at the shared host, exactly once.
  //
  // ROUND 3 (review findings 1+2): this is no longer a React `onKeyDown` on
  // the frame. That shape had no way to outrank a workspace whose own
  // `document`/`window` listener `preventDefault()`s every Escape it sees, so
  // with Tiles or the Quick Figure Builder open the WORKSPACE closed and the
  // focused workshop stayed put — undismissable from the keyboard. The window
  // now registers on the shared ordered registry (`lib/escapeStack.ts`) in the
  // `window` layer, which is in front of every workspace; that module's header
  // carries the phase/deferral reasoning (round 2's finding 2) that used to
  // live here.
  //
  // One guard of its own:
  //  - focus must be INSIDE this frame. Several windows can be open at once,
  //    and Escape belongs to the one the user is in — not to whichever mounted
  //    last. Declining lets the walk fall through to the surface below, which
  //    is how Escape still closes Tiles while focus is on a Library row.
  // ROUND 4 (review of round 3, finding 1): there used to be a second guard
  // here — a per-mount `closed` ref, set before `onClose()` ran and never
  // reset. It was wrong twice over, and both halves were user-visible.
  //
  // Not every `onClose` unmounts the window. `usePageLifecycle.requestClose`
  // asks "Close without saving?" for a saved page with unsaved edits and
  // leaves the panel mounted when the user says no; `PackProjectPanel`
  // deliberately stays put while packing or cancelling. For those panels the
  // latch stuck on after the first Escape, so (a) every later Escape was dead
  // — the panel was mouse-closable and keyboard-undismissable, the exact shape
  // of round 2's defect — and (b) the guard DECLINED rather than doing
  // nothing, so the walk fell straight through and the workspace behind the
  // focused panel closed instead. Measured on the round-3 tree: Escape ①
  // called `onClose` once, Escape ② called it 0 more times and closed Tiles.
  //
  // So the window CLAIMS the key whenever it is the innermost surface and it
  // invoked `onClose` — claiming is not conditional on unmounting. "One
  // keystroke, one close" is the registry's job and stays entirely there: it
  // ignores `event.repeat` (a held key) and clears any pending walk before
  // arming a new one (two Escapes in one tick), so a single burst runs the
  // walk exactly once. A later, SEPARATE keypress is a second intent and must
  // reach the panel again — that is how the declined confirm reappears.
  const closeLatest = useRef(closeNow);
  useEffect(() => {
    closeLatest.current = closeNow;
  });
  useEscapeSurface(
    "window",
    (e) => {
      const frame = winRef.current;
      if (!frame || !(e.target instanceof Node) || !frame.contains(e.target)) return false;
      closeLatest.current();
      return true;
    },
    onClose !== undefined,
  );

  // Take focus on open so that Escape — and Tab into the panel's controls —
  // works immediately. A workshop launched from the command palette or a menu
  // otherwise leaves focus on the unmounted trigger, i.e. on <body>, where a
  // root-level React handler never fires. Focus lands on the FRAME
  // (`tabIndex={-1}`), never on a control, so nothing is armed to activate.
  // Non-modal: nothing is trapped.
  //
  // Round 2 (review finding 5): skipped when something inside the frame is
  // already focused after the first commit. React applies a child's
  // `autoFocus` during that commit and this passive effect runs after it, so
  // the first cut took focus back off any panel that opens straight into a
  // field — the opposite of what its own commit body claimed.
  useEffect(() => {
    const frame = winRef.current;
    if (frame && !frame.contains(document.activeElement)) frame.focus({ preventScroll: true });
  }, []);

  const onTitleDown = (e: React.PointerEvent) => {
    dragRef.current = { dx: e.clientX - layout.x, dy: e.clientY - layout.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onTitleMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setLayout(id, { ...layout, x: e.clientX - dragRef.current.dx, y: e.clientY - dragRef.current.dy });
  };
  const onTitleUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    (e.target as Element).releasePointerCapture(e.pointerId);
    const current = useApp.getState().toolWindowLayout[id] ?? layout;
    setLayout(id, { ...current, ...clampNow(current.x, current.y, current.width) });
  };

  const onResizeDown = (e: React.PointerEvent) => {
    e.stopPropagation(); // never also starts a title-bar drag
    resizeRef.current = {
      x: e.clientX,
      y: e.clientY,
      w: layout.width,
      h: layout.height ?? winRef.current?.offsetHeight ?? MIN_HEIGHT,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    setLayout(id, {
      ...layout,
      width: Math.max(MIN_WIDTH, r.w + (e.clientX - r.x)),
      height: Math.max(MIN_HEIGHT, r.h + (e.clientY - r.y)),
    });
  };
  const onResizeUp = (e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    (e.target as Element).releasePointerCapture(e.pointerId);
    const current = useApp.getState().toolWindowLayout[id] ?? layout;
    setLayout(id, { ...current, ...clampNow(current.x, current.y, current.width) });
  };

  const onCollapseToggle = () => toggleCollapsed(id, fallback);

  return (
    <div
      ref={winRef}
      className="qzk-glass qzk-win"
      tabIndex={-1}
      style={{
        left: layout.x,
        top: layout.y,
        zIndex: 200 + z,
        width: layout.width,
        height: layout.collapsed ? undefined : (layout.height ?? undefined),
      }}
      onMouseDown={() => setZ(++zTop)}
    >
      <div
        ref={titleRef}
        className="qzk-win-title"
        title="Drag to move · double-click to collapse"
        onPointerDown={onTitleDown}
        onPointerMove={onTitleMove}
        onPointerUp={onTitleUp}
        onDoubleClick={onCollapseToggle}
      >
        {onClose && (
          <button
            className="qzk-win-close"
            title="Close"
            onPointerDown={(e) => e.stopPropagation()}
            // `closeNow`, not `onClose`: the ✕ unmounts the panel with focus
            // ON ITSELF, so the restore has to run before it disappears.
            onClick={closeNow}
          />
        )}
        <span className="grow">{title}</span>
        {topic && (
          <button
            type="button"
            className="qz-card-help"
            aria-label={`Help for ${typeof title === "string" ? title : "this panel"}`}
            data-tip="Open related help"
            data-tip-desc="Show Help already filtered to this panel's related tools."
            // The title bar IS the drag handle; Close and Collapse both stop
            // pointerdown reaching it, and so must this or `?` picks the
            // window up.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              openHelpTopic(topic);
            }}
          >
            {/* Decorative: the accessible name comes from aria-label above. */}
            <span aria-hidden="true">?</span>
          </button>
        )}
        <button
          className="qzk-win-collapse"
          title={layout.collapsed ? "Expand" : "Collapse"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onCollapseToggle}
        >
          {layout.collapsed ? "▸" : "▾"}
        </button>
      </div>
      {!layout.collapsed && (
        <>
          <div className="qzk-win-body">{children}</div>
          <div
            className="qzk-win-resize"
            aria-hidden="true"
            title="Resize"
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
          />
        </>
      )}
    </div>
  );
}
