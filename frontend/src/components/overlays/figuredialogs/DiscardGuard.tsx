// E6 of plans/OBJECT_EDITOR_CONTRACT.md: a mousedown OUTSIDE a figure popup
// that has been edited asks before it throws the draft away. The host
// (FigureDialogs) owns this once, so every popup (Axis, Plot details, Legend,
// Layer, Gradient, Plot setup, Layer contents) gets it with no per-dialog
// wiring: "edited" is simply "an input or change event happened inside the
// dialog root".
//
// The question is an inline bar at the bottom of the popup, not the shared
// confirm store: its buttons must read "Keep editing" / "Discard" (the shared
// dialog's safe button is a fixed "Cancel", which would read as "cancel the
// popup"), and it adds no eager JS. It is a modal on the escape stack, so Esc
// answers the question (Keep editing) and the popup stays; Esc on the popup
// itself stays an explicit Cancel that closes without asking.

import { useCallback, useEffect, useRef, useState } from "react";

import { useEscapeSurface } from "../../../lib/escapeStack";
import type { FigureDialog } from "../../../store/figureDialogs";

export function useDiscardGuard(open: FigureDialog, close: () => void) {
  const edited = useRef(false);
  const [asking, setAsking] = useState(false);
  // A different popup (a new `open` value) starts clean.
  useEffect(() => {
    edited.current = false;
    setAsking(false);
  }, [open]);

  const markEdited = useCallback(() => {
    edited.current = true;
  }, []);
  /** Mousedown on the dimmed backdrop. */
  const onBackdrop = useCallback(() => {
    if (edited.current) setAsking(true);
    else close();
  }, [close]);
  const keepEditing = useCallback(() => setAsking(false), []);
  useEscapeSurface("modal", () => { setAsking(false); return true; }, asking);

  return {
    asking,
    onBackdrop,
    keepEditing,
    /** Spread onto the dialog root. */
    editProps: { onInputCapture: markEdited, onChangeCapture: markEdited },
  };
}

export function DiscardBar({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  const keepRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const from = document.activeElement as HTMLElement | null;
    keepRef.current?.focus();
    return () => { if (from?.isConnected) from.focus(); };
  }, []);
  return (
    <div
      role="group"
      aria-label="Discard your changes?"
      style={{ position: "sticky", bottom: 0, display: "flex", alignItems: "center", gap: 8, padding: "8px 0 0", background: "var(--surface-1)" }}
    >
      <strong style={{ flex: 1 }}>Discard your changes?</strong>
      <button type="button" className="qz-btn qz-primary" ref={keepRef} onClick={onKeep}>Keep editing</button>
      <button type="button" className="qz-btn" onClick={onDiscard}>Discard</button>
    </div>
  );
}
