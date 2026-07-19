// Promise-based confirm dialog: askConfirm(title, message?, confirmLabel?, danger?)
// resolves true on confirm, false on cancel / backdrop / Escape. A styled,
// on-brand alternative to window.confirm for destructive actions (Remove all,
// …). Mount one <ConfirmDialog/> at the app root (next to <ParamDialog/>).
// Modeled on ParamDialog's promise+zustand pattern.

import { useEffect } from "react";
import { create } from "zustand";

import { Button } from "../primitives";

interface ConfirmState {
  title: string | null;
  message: string;
  confirmLabel: string;
  danger: boolean;
  resolve: ((ok: boolean) => void) | null;
  open: (
    title: string,
    message: string,
    confirmLabel: string,
    danger: boolean,
    resolve: (ok: boolean) => void,
  ) => void;
  close: () => void;
}

const useConfirm = create<ConfirmState>((set) => ({
  title: null,
  message: "",
  confirmLabel: "OK",
  danger: false,
  resolve: null,
  open: (title, message, confirmLabel, danger, resolve) =>
    set({ title, message, confirmLabel, danger, resolve }),
  close: () => set({ title: null, message: "", confirmLabel: "OK", danger: false, resolve: null }),
}));

/** Open a confirm dialog; resolves true on confirm, false on cancel/backdrop/Esc. */
export function askConfirm(
  title: string,
  message = "",
  confirmLabel = "OK",
  danger = false,
): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirm.getState().open(title, message, confirmLabel, danger, resolve);
  });
}

export default function ConfirmDialog() {
  const title = useConfirm((s) => s.title);
  const message = useConfirm((s) => s.message);
  const confirmLabel = useConfirm((s) => s.confirmLabel);
  const danger = useConfirm((s) => s.danger);
  const resolve = useConfirm((s) => s.resolve);
  const close = useConfirm((s) => s.close);

  // Enter confirms, Escape cancels — captured before app-level shortcuts so the
  // dialog owns those keys while open (capture phase + stopPropagation).
  useEffect(() => {
    if (title === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      resolve?.(e.key === "Enter");
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [title, resolve, close]);

  if (title === null) return null;

  const finish = (ok: boolean) => {
    resolve?.(ok);
    close();
  };

  return (
    <div className="qz-overlay-backdrop" onMouseDown={() => finish(false)}>
      <div className="qzk-glass qz-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {message && <p>{message}</p>}
        {/* #17: a destructive confirm is SEPARATED from Cancel rather than
            sitting flush against it as an equal-width twin -- order stays
            secondary-first/primary-last, but the irreversible button is no
            longer one stray pixel away from the safe one. */}
        <div className={danger ? "qz-btn-row qz-btn-row--danger" : "qz-btn-row"}>
          <Button onClick={() => finish(false)}>Cancel</Button>
          {danger && <span className="qz-btn-row-gap" data-testid="destructive-gap" aria-hidden="true" />}
          <Button variant={danger ? "danger" : "primary"} onClick={() => finish(true)}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
