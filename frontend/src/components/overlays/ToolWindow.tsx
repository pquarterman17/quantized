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
// never end up with its grab handle unreachable. The title bar is also a Tab
// stop whose arrow keys move the window and Shift+arrows resize it (R3).

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { isModalOpen } from "../../lib/appShortcuts";
import { useEscapeSurface } from "../../lib/escapeStack";
import {
  clampToolWindowPos,
  defaultToolWindowLayout,
  keyboardLayout,
  MIN_HEIGHT,
  STATUS_BAR_HEIGHT,
  TITLE_BAR_HEIGHT,
  UNDOCK_DRAG,
} from "../../lib/toolwindow";
import { Z } from "../../lib/layers";
import { nextToolZ, raiseToolWindow, registerToolWindow, type ToolZHandle } from "../../lib/toolWindowZ";
import { workshopHelpTopic } from "../../lib/workshopHelp";
import { useApp } from "../../store/useApp";
import { floatingX } from "./floatingX";
import ToolWindowResizeGrip from "./ToolWindowResizeGrip";
import ToolWindowTitleButtons from "./ToolWindowTitleButtons";
import { useOpenerRestore } from "./useDialogFocus";
import { useToolWindowDock } from "./useToolWindowDock";

// Focus order lives in lib/toolWindowZ.ts, bounded to the tool-window band.

/** A window with no saved position opens clear of the Library panel, not over
 *  it: the Library is where the user picks what the window acts on (and was
 *  widened for Origin book names, so the old fixed x=120 covered its rows).
 *  The usual clamp still keeps a narrow viewport's window on screen. */
function clearOfLibrary(x: number): number {
  const right = typeof document === "undefined" ? 0 : (document.querySelector(".qzk-library")?.getBoundingClientRect().right ?? 0);
  return right > 0 ? Math.max(x, Math.round(right) + 8) : x;
}

export default function ToolWindow({
  id,
  title,
  x = 120,
  y = 90,
  width = 360,
  onClose,
  helpTopic,
  dockable = false,
  header,
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
  /** UX-F: the window opens DOCKED in the side column, replacing the
   *  Inspector (store/toolDock.ts), with a title-bar button (or a drag) to
   *  float it and one to dock it again. */
  dockable?: boolean;
  /** A band between the title bar and the scrolling body that stays in view
   *  (e.g. Curve Fit's model, Fit button, status and tabs). */
  header?: ReactNode;
  children: ReactNode;
}) {
  const stored = useApp((s) => s.toolWindowLayout[id]);
  const setLayout = useApp((s) => s.setToolWindowLayout);
  const toggleCollapsed = useApp((s) => s.toggleToolWindowCollapsed);
  const fallback = defaultToolWindowLayout(clearOfLibrary(x), y, width);
  const layout = stored ?? fallback;
  const dock = useToolWindowDock(id, dockable, layout.width);
  const docked = dock.docked;
  // A docked window is never shown collapsed: the column would hold a bare bar.
  const collapsed = layout.collapsed && !docked;
  const undockDragRef = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);
  // P3.1: registry-driven by default (lib/workshopHelp.ts) so no panel needs
  // its own edit; an explicit `helpTopic` still wins, including for a window
  // with no registry entry.
  const topic = helpTopic ?? workshopHelpTopic(id);
  // The title-bar buttons' accessible names say WHICH panel they act on.
  const panelName = typeof title === "string" ? title : "this panel";

  const [z, setZ] = useState(nextToolZ);
  const zHandle = useRef<ToolZHandle>({ z, set: setZ });
  useEffect(() => registerToolWindow(zHandle.current), []);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const winRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  const clampNow = (nx: number, ny: number, w: number) => {
    const th = titleRef.current?.offsetHeight ?? TITLE_BAR_HEIGHT;
    return clampToolWindowPos(nx, ny, w, th, { width: window.innerWidth, height: window.innerHeight - STATUS_BAR_HEIGHT });
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
  // keyboard — the only close affordance in the whole family of panels (40
  // production components render this host at round 6, 41 render sites) was
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
  //
  // Never while a modal dialog is open: a window opened under it (from the
  // store, a background operation) is background and must not take focus.
  // The inert walk normally refuses it, but a DOCKED window's layout-effect
  // claim (useToolWindowDock) re-renders synchronously, which flushes this
  // passive effect early -- before the walk's MutationObserver has marked the
  // new node inert -- and WebKit and Firefox then moved focus out of the
  // dialog (modal-inert.spec, CI on PR #723). This gate does not race.
  useEffect(() => {
    const frame = winRef.current;
    if (frame && !isModalOpen() && !frame.contains(document.activeElement)) frame.focus({ preventScroll: true });
  }, []);

  const onTitleDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    if (docked) {
      // UX-F: a press on a docked bar arms "drag out to float"; a click alone
      // does nothing.
      const box = winRef.current?.getBoundingClientRect();
      const dx = Math.min(e.clientX - (box?.left ?? 0), layout.width - 24);
      undockDragRef.current = { x: e.clientX, y: e.clientY, dx: Math.max(0, dx), dy: e.clientY - (box?.top ?? 0) };
      return;
    }
    dragRef.current = { dx: e.clientX - layout.x, dy: e.clientY - layout.y };
  };
  const onTitleMove = (e: React.PointerEvent) => {
    const pending = undockDragRef.current;
    if (pending && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) >= UNDOCK_DRAG) {
      undockDragRef.current = null;
      dragRef.current = { dx: pending.dx, dy: pending.dy };
      setLayout(id, { ...layout, collapsed: false, x: e.clientX - pending.dx, y: e.clientY - pending.dy });
      dock.undock();
      return;
    }
    if (!dragRef.current) return;
    setLayout(id, { ...layout, x: e.clientX - dragRef.current.dx, y: e.clientY - dragRef.current.dy });
  };
  const onTitleUp = (e: React.PointerEvent) => {
    undockDragRef.current = null;
    if (!dragRef.current) return;
    dragRef.current = null;
    (e.target as Element).releasePointerCapture(e.pointerId);
    clampLatest();
  };
  /** Re-clamp the latest stored layout (a drag or a resize just ended). */
  const clampLatest = () => {
    const current = useApp.getState().toolWindowLayout[id] ?? layout;
    setLayout(id, { ...current, ...clampNow(current.x, current.y, current.width) });
  };

  // Floated other than by a drag (its Float button, a double-click, the
  // Inspector toggle, another window taking the column): it lands just left
  // of the side column, at its own height -- never at a stale saved x over
  // the Inspector.
  const wasDocked = useRef(docked);
  useEffect(() => {
    if (wasDocked.current && !docked && !dragRef.current) {
      const cur = useApp.getState().toolWindowLayout[id] ?? layout;
      const next = { ...cur, collapsed: false, x: floatingX(cur.width, id) };
      setLayout(id, { ...next, ...clampNow(next.x, next.y, next.width) });
    }
    wasDocked.current = docked;
  });

  // R3: the focused title bar's keyboard twin of the drag and resize grip,
  // clamped like a drag end. Only on the bar itself: its buttons keep their
  // keys, and a claimed arrow never also steps the global dataset navigation.
  // A docked window does not move; its Float button is the keyboard route out.
  const onTitleKey = (e: React.KeyboardEvent) => {
    if (docked || e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
    const next = keyboardLayout(layout, e.key, e.shiftKey, winRef.current?.offsetHeight ?? MIN_HEIGHT);
    if (!next) return;
    e.preventDefault();
    setLayout(id, { ...next, ...clampNow(next.x, next.y, next.width) });
  };

  const onCollapseToggle = () => {
    if (!docked) toggleCollapsed(id, fallback);
  };
  // Double-clicking a dock-capable window's title bar floats / docks it.
  const onTitleDouble = dockable ? (docked ? dock.undock : dock.dock) : onCollapseToggle;

  // Docked: over the column's slot (useToolWindowDock). No slot (no shell: an
  // error fallback, a unit test) leaves it where a floating one would be.
  const r = dock.rect;
  const place: CSSProperties = docked && r
    ? { position: "fixed", left: r.left, top: r.top, width: r.width || layout.width, height: r.height || undefined }
    : { left: layout.x, top: layout.y, width: layout.width, height: collapsed ? undefined : (layout.height ?? undefined), "--qzk-win-top": `${layout.y}px` } as CSSProperties;

  return (
    <div
      ref={winRef}
      className={`qzk-glass qzk-win${docked && r ? " qzk-win-docked" : ""}`}
      data-tool-window={id}
      data-docked={docked ? "" : undefined}
      // A NON-modal dialog (no trap, no inert background), named by its
      // visible title, so a screen reader announces which panel focus is in.
      // Docked too: the dialog inventory ratchet audits every surface by this
      // literal role, and the docked panel keeps the same focus/Escape model.
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      // --qzk-win-top: shell.css caps a floating window above the status bar.
      style={{ ...place, zIndex: Z.toolBase + z }}
      onMouseDown={() => raiseToolWindow(zHandle.current)}
    >
      <div
        ref={titleRef}
        className="qzk-win-title"
        tabIndex={0}
        role="group"
        aria-label={`${panelName} title bar`}
        title={
          docked
            ? "Docked in the side panel. Drag the title bar out, or double-click it, to float it."
            : "Drag or press the arrow keys to move, Shift+arrow keys to resize, double-click to " + (dockable ? "dock." : "collapse.")
        }
        onKeyDown={onTitleKey}
        onPointerDown={onTitleDown}
        onPointerMove={onTitleMove}
        onPointerUp={onTitleUp}
        onDoubleClick={onTitleDouble}
      >
        {onClose && (
          <button
            className="qzk-win-close"
            title="Close"
            // R4: name the panel, like Help below, so two open ✕s differ.
            aria-label={`Close ${panelName}`}
            onPointerDown={(e) => e.stopPropagation()}
            // `closeNow`, not `onClose`: the ✕ unmounts the panel with focus
            // ON ITSELF, so the restore has to run before it disappears.
            onClick={closeNow}
          />
        )}
        <span className="grow" id={titleId}>{title}</span>
        <ToolWindowTitleButtons
          panelName={panelName}
          topic={topic}
          dockable={dock.dockable}
          docked={docked}
          collapsed={collapsed}
          onDock={dock.dock}
          onFloat={dock.undock}
          onCollapseToggle={onCollapseToggle}
        />
      </div>
      {!collapsed && (
        <>
          {header && <div className="qzk-win-head">{header}</div>}
          <div className="qzk-win-body">{children}</div>
          {!docked && <ToolWindowResizeGrip id={id} layout={layout} frame={winRef} onEnd={clampLatest} />}
        </>
      )}
    </div>
  );
}
