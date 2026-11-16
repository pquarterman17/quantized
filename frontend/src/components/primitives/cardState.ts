// UX-A: lets a container (the Inspector) control which of its Cards are open
// and ask one to scroll into view, without each card component threading
// props. A Card with no provider above it keeps its old uncontrolled
// `defaultOpen` behaviour, so every other Card in the app is unchanged.

import { createContext } from "react";

export interface CardStateApi {
  /** Is card `id` open? `fallback` is the card's own `defaultOpen`. */
  isOpen: (id: string, fallback: boolean) => boolean;
  /** The user opened / closed card `id` (its `<details>` toggled). */
  setOpen: (id: string, open: boolean) => void;
  /** Card to scroll into view; `n` changes on every request, so asking for
   *  the same card again scrolls again. */
  reveal: { id: string; n: number } | null;
}

export const CardStateContext = createContext<CardStateApi | null>(null);
