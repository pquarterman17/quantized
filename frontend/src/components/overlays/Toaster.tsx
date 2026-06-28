// Toast stack (design interaction layer): a fixed, centered column of glass pills
// above the status bar. Pure renderer — the queue + auto-dismiss live in
// store/toasts. Click a toast to dismiss it early.

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
        </div>
      ))}
    </div>
  );
}
