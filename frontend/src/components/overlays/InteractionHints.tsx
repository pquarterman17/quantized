// Optional first-run interaction hints (GUI_INTERACTION_PLAN #17). Kept to a
// small, dismissible card rather than a modal tour: it teaches the three
// highest-leverage mouse conventions without blocking the first import.

import { useEffect, useState } from "react";

import { Button } from "../primitives";

const SEEN_KEY = "qz.interactionHints.seen";
export const SHOW_INTERACTION_HINTS = "qz:show-interaction-hints";

export function showInteractionHints(): void {
  window.dispatchEvent(new Event(SHOW_INTERACTION_HINTS));
}

export default function InteractionHints() {
  const [open, setOpen] = useState(() => localStorage.getItem(SEEN_KEY) !== "1");

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(SHOW_INTERACTION_HINTS, show);
    return () => window.removeEventListener(SHOW_INTERACTION_HINTS, show);
  }, []);

  if (!open) return null;
  const dismiss = () => {
    localStorage.setItem(SEEN_KEY, "1");
    setOpen(false);
  };

  return (
    <aside
      className="qzk-glass"
      aria-label="Interaction hints"
      style={{ position: "fixed", right: 16, bottom: 34, width: 310, zIndex: 1200, padding: 12 }}
    >
      <strong>Three fast ways to work</strong>
      <ul style={{ margin: "8px 0 10px", paddingLeft: 20, lineHeight: 1.55 }}>
        <li>Right-click a curve, axis, legend, or empty plot area for relevant actions.</li>
        <li>Double-click a plot object to edit its properties.</li>
        <li>Drag worksheet channels onto the X, Y, or Y2 plot edges.</li>
      </ul>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="qz-hint">Help ▸ Show interaction hints reopens this.</span>
        <Button size="sm" onClick={dismiss}>Got it</Button>
      </div>
    </aside>
  );
}
