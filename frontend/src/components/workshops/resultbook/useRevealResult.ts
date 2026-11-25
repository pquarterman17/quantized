// Scroll a tool window's new result into view after Run (UX audit P2-9): the
// result is appended below the form, often below the fold of a small window.
// Returns the ref to put on the result's wrapper; `result` is any value whose
// identity changes with each new result (null or undefined: nothing to show).
// Smooth scrolling is the browser's call (prefers-reduced-motion is honored by
// "auto"); jsdom has no scrollIntoView, hence the optional call.

import { useEffect, useRef } from "react";

export function useRevealResult(result: unknown): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (result == null) return;
    ref.current?.scrollIntoView?.({ block: "start", behavior: "auto" });
  }, [result]);
  return ref;
}
