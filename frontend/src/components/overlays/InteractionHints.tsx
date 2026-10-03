// Optional first-run interaction hints (GUI_INTERACTION_PLAN #17). Kept to a
// small, dismissible card rather than a modal tour: it teaches the three
// highest-leverage mouse conventions without blocking the first import.
// This gate stays eager (it owns the Help-menu reopen listener); the card
// itself (InteractionHintsCard) loads on demand.

import { useEffect, useState } from "react";

import { lazyRegion } from "../../lib/lazyRegion";
import { useApp } from "../../store/useApp";

const SEEN_KEY = "qz.interactionHints.seen";
export const SHOW_INTERACTION_HINTS = "qz:show-interaction-hints";

const InteractionHintsCard = lazyRegion(() => import("./InteractionHintsCard"), "Interaction hints");

export function showInteractionHints(): void {
  window.dispatchEvent(new Event(SHOW_INTERACTION_HINTS));
}

export default function InteractionHints() {
  // 1 = first run, 2 = reopened from Help. A first-run card only shows on an
  // empty workspace: once data loads it would sit over the plot's right edge.
  const [open, setOpen] = useState(() => +(localStorage.getItem(SEEN_KEY) !== "1"));
  const hasData = useApp((s) => s.datasets.length > 0);

  useEffect(() => {
    const show = () => setOpen(2);
    window.addEventListener(SHOW_INTERACTION_HINTS, show);
    return () => window.removeEventListener(SHOW_INTERACTION_HINTS, show);
  }, []);

  if (!open || (hasData && open < 2)) return null;
  return (
    <InteractionHintsCard
      onDismiss={() => {
        localStorage.setItem(SEEN_KEY, "1");
        setOpen(0);
      }}
    />
  );
}
