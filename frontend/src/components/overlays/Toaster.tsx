// Toast stack (design interaction layer): a fixed, centered column of glass pills
// above the status bar. Pure renderer — the queue + auto-dismiss live in
// store/toasts. Click a toast to dismiss it early; a toast carrying an
// action (store/toasts.ts's ToastAction) also renders an inline button —
// clicking it fires the action AND dismisses (PLOT_WORKFLOW_PLAN #4's
// batch-overlay offer is the first caller). Not clicking it is a legitimate
// decline: the toast still auto-dismisses on its own timer either way — but
// never while the pointer is over it or focus is in it (WCAG 2.2.1).

import type { FocusEvent } from "react";

import { useToasts, type Toast } from "../../store/toasts";

function ToastPill({ t }: { t: Toast }) {
  const danger = t.kind === "danger";
  const dismiss = useToasts((s) => s.dismiss);
  const hold = useToasts((s) => s.hold);
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hold(t.id, "focus", false);
  };
  return (
    <div
      className={`qzk-toast${t.kind !== "info" ? ` ${t.kind}` : ""}`}
      role={danger ? "alert" : undefined}
      onClick={() => dismiss(t.id)}
      onMouseEnter={() => hold(t.id, "hover", true)}
      onMouseLeave={() => hold(t.id, "hover", false)}
      onFocus={() => hold(t.id, "focus", true)}
      onBlur={onBlur}
    >
      {t.msg}
      {t.action && (
        <button
          type="button"
          className="qzk-toast-action"
          onClick={(e) => {
            e.stopPropagation();
            t.action?.onClick();
            dismiss(t.id);
          }}
        >
          {t.action.label}
        </button>
      )}
    </div>
  );
}

export default function Toaster() {
  const toasts = useToasts((s) => s.toasts);
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
    <div className="qzk-toaster" aria-live="polite" data-live-region="">
      {toasts.map((t) => t.kind !== "danger" && <ToastPill key={t.id} t={t} />)}
      <div className="qzk-toast-alerts" aria-live="assertive">
        {toasts.map((t) => t.kind === "danger" && <ToastPill key={t.id} t={t} />)}
      </div>
    </div>
  );
}
