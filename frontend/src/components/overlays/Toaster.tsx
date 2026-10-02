// Toast stack (design interaction layer): a fixed, centered column of glass pills
// above the status bar. Pure renderer — the queue + auto-dismiss live in
// store/toasts. Click a toast to dismiss it early; a toast carrying an
// action (store/toasts.ts's ToastAction) also renders an inline button —
// clicking it fires the action AND dismisses (PLOT_WORKFLOW_PLAN #4's
// batch-overlay offer is the first caller). Not clicking it is a legitimate
// decline: the toast still auto-dismisses on its own timer either way — but
// never while the pointer is over it or focus is in it (WCAG 2.2.1).

import { useRef, type FocusEvent, type MouseEvent } from "react";

import { absorbStrayDeleteOnContainer } from "../../lib/focusGuard";
import { useToasts, type Toast } from "../../store/toasts";

export default function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  const hold = useToasts((s) => s.hold);
  const rootRef = useRef<HTMLDivElement>(null);
  // Where focus was before it entered each toast, to give it back after the
  // action button (which unmounts with its toast) is used.
  const cameFrom = useRef(new Map<number, Element | null>());
  // Focus moving WITHIN a toast is neither a new hold nor a release.
  const focusHold = (t: Toast, on: boolean) => (e: FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    hold(t.id, on);
    if (on) cameFrom.current.set(t.id, e.relatedTarget);
    else cameFrom.current.delete(t.id);
  };
  // Focus left on the vanishing button would drop to <body>, where Delete
  // removes the active dataset: return it, else to this Delete-absorbing root.
  const onAction = (t: Toast) => (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    const back = cameFrom.current.get(t.id);
    t.action?.onClick();
    dismiss(t.id);
    const stranded = () => document.activeElement === btn || document.activeElement === document.body;
    if (stranded() && back instanceof HTMLElement && back.isConnected) back.focus();
    if (stranded()) rootRef.current?.focus();
  };
  const pill = (t: Toast) => (
    <div
      key={t.id}
      className={`qzk-toast${t.kind !== "info" ? ` ${t.kind}` : ""}`}
      role={t.kind === "danger" ? "alert" : undefined}
      onClick={() => dismiss(t.id)}
      onMouseEnter={() => hold(t.id, true)}
      onMouseLeave={() => hold(t.id, false)}
      onFocus={focusHold(t, true)}
      onBlur={focusHold(t, false)}
    >
      {t.msg}
      {t.action && (
        <button
          type="button"
          className="qzk-toast-action"
          onClick={onAction(t)}
        >
          {t.action.label}
        </button>
      )}
    </div>
  );
  // Rendered even while empty: screen readers commonly skip a live region
  // that enters the DOM together with its first text, which lost the first
  // toast's announcement (often the only one). The same holds for the nested
  // assertive region a danger toast (role="alert") lands in: the nearest live
  // region wins, so a failure is announced at once and not also politely.
  return (
    // `data-live-region` (R12) exempts this element from the `inert` a modal
    // dialog puts on everything around it (lib/modalInert.ts, which also
    // catches this node appearing WHILE a dialog is open). Without it a toast
    // raised meanwhile reached the screen but not the accessibility tree.
    // Spelled as a literal: importing the constant would pull modalInert into
    // the entry chunk; modalInert.test.tsx pins the spelling.
    <div
      ref={rootRef}
      className="qzk-toaster"
      aria-live="polite"
      data-live-region=""
      tabIndex={-1}
      onKeyDown={absorbStrayDeleteOnContainer}
    >
      {toasts.map((t) => t.kind !== "danger" && pill(t))}
      <div className="qzk-toast-alerts" aria-live="assertive">
        {toasts.map((t) => t.kind === "danger" && pill(t))}
      </div>
    </div>
  );
}
