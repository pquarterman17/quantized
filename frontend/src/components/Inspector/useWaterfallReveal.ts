// UX9-D: Plot ▸ Layout ▸ Waterfall… (commands/waterfallCommand.ts) asks the
// Channels card to open and bring its Waterfall slider into view. The command
// is eager and this card is lazy, so the request is a window event.

import { useContext, useEffect, useRef, type RefObject } from "react";

import { REVEAL_WATERFALL_EVENT } from "../../commands/waterfallCommand";
import { CardStateContext } from "../primitives/cardState";

/** Ref for the element wrapping the slider; the card id is the card title. */
export function useWaterfallReveal(cardId: string): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  const card = useContext(CardStateContext);
  useEffect(() => {
    const onReveal = () => {
      card?.setOpen(cardId, true);
      // After the card's <details> has opened and laid out.
      requestAnimationFrame(() => ref.current?.scrollIntoView?.({ block: "nearest" }));
    };
    window.addEventListener(REVEAL_WATERFALL_EVENT, onReveal);
    return () => window.removeEventListener(REVEAL_WATERFALL_EVENT, onReveal);
  }, [card, cardId]);
  return ref;
}
