// UX-A: the Inspector's CardStateContext value. A card is open when the user
// opened it in this context (remembered across reloads, store/inspectorCards)
// or when it is the card the current selection points at (`focus`), which is
// also scrolled into view. Collapsing that focused card wins until the
// selection changes, so the user can always close what selection opened.

import { useMemo, useState } from "react";

import { setCardOpen, useInspectorCards } from "../../store/inspectorCards";
import type { CardStateApi } from "../primitives/cardState";

export function useInspectorCardState(ctx: string, focus: string | null, focusKey: string): CardStateApi {
  const stored = useInspectorCards((s) => s.open[ctx]);
  // Count selection changes (React's "adjust state while rendering" pattern):
  // each new focus gets a fresh reveal number, so it scrolls even when the
  // same card was focused before.
  const [seen, setSeen] = useState(focusKey);
  const [n, setN] = useState(focusKey ? 1 : 0);
  const [dismissed, setDismissed] = useState(-1);
  if (seen !== focusKey) {
    setSeen(focusKey);
    setN(n + 1);
  }
  const forced = focus !== null && dismissed !== n ? focus : null;
  return useMemo<CardStateApi>(
    () => ({
      isOpen: (id, fallback) => id === forced || (stored?.[id] ?? fallback),
      setOpen: (id, open) => {
        if (!open && id === forced) setDismissed(n);
        setCardOpen(ctx, id, open);
      },
      reveal: forced ? { id: forced, n } : null,
    }),
    [ctx, forced, n, stored],
  );
}
