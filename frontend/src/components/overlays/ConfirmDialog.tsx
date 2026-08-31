// Promise-based confirm dialog: askConfirm(title, message?, confirmLabel?, danger?)
// resolves true on confirm, false on cancel / backdrop / Escape. A styled,
// on-brand alternative to window.confirm for destructive actions (Remove all,
// …). Mount one <ConfirmDialog/> at the app root (next to <ParamDialog/>).
// Modeled on ParamDialog's promise+zustand pattern.

import { useEffect, useId, useRef } from "react";
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
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const messageId = useId();

  // Enter confirms, Escape cancels — captured before app-level shortcuts so the
  // dialog owns those keys while open (capture phase + stopPropagation).
  //
  // `e.repeat` is ignored, and that is a safety guard rather than a nicety.
  // This listener mounts in an effect AFTER the dialog renders, so a user who
  // opened the dialog by holding Enter on the triggering button — or who
  // leans on Enter because nothing appeared to happen — has the very next
  // auto-repeat land here as a CONFIRM, before they have read the question.
  // On a delete that cannot be undone, that is the whole safeguard bypassed.
  useEffect(() => {
    if (title === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.stopPropagation(); // this dialog owns both keys while it is open
      if (e.repeat) {
        e.preventDefault();
        return;
      }
      // Enter must NOT mean "confirm" while a button has focus, or it
      // overrides the button the user is actually on. Focus now lands on
      // Cancel, so treating Enter as confirm here would turn the safest
      // keyboard gesture in the dialog into the destructive one — the exact
      // opposite of what moving focus there was for. Let the browser activate
      // whatever is focused instead. Escape always cancels.
      if (e.key === "Enter" && (e.target as HTMLElement | null)?.closest?.("button")) return;
      e.preventDefault();
      resolve?.(e.key === "Enter");
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [title, resolve, close]);

  // Move focus INTO the dialog, onto Cancel — the safe choice, so a stray
  // Space/Enter on the newly focused control dismisses rather than destroys.
  // Without this, focus stays on the button behind the backdrop and a screen
  // reader is never taken to the question at all.
  useEffect(() => {
    if (title === null) return;
    // Cancel is the FIRST button in the row, so this is the safe default: a
    // stray Space/Enter on it dismisses rather than destroys. Queried through
    // the container because the shared `Button` primitive does not forward a
    // ref, and widening that primitive for one caller is not worth it.
    dialogRef.current?.querySelector("button")?.focus();
  }, [title]);

  if (title === null) return null;

  const finish = (ok: boolean) => {
    resolve?.(ok);
    close();
  };

  return (
    <div className="qz-overlay-backdrop" onMouseDown={() => finish(false)}>
      {/* role/aria-modal/labelledby so assistive tech announces this as a
          dialog and reads the question. Without them the backdrop is just a
          div, and the only gate on an irreversible delete is invisible. */}
      <div
        className="qzk-glass qz-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        {message && <p id={messageId}>{message}</p>}
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
