// Toast stack (design interaction layer): a fixed, centered column of glass pills
// above the status bar. Pure renderer — the queue + auto-dismiss live in
// store/toasts. Click a toast to dismiss it early; a toast carrying an
// action (store/toasts.ts's ToastAction) also renders an inline button —
// clicking it fires the action AND dismisses (PLOT_WORKFLOW_PLAN #4's
// batch-overlay offer is the first caller). Not clicking it is a legitimate
// decline: the toast still auto-dismisses on its own timer either way.

import { useToasts } from "../../store/toasts";

export default function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="qzk-toaster" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`qzk-toast${t.kind !== "info" ? ` ${t.kind}` : ""}`}
          onClick={() => dismiss(t.id)}
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
      ))}
    </div>
  );
}
