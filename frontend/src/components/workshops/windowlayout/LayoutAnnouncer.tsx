// The layout's polite live region and the announcer that feeds it: whenever a
// window docks, floats or closes (whatever caused it) the one-sentence change
// is announced. The first layout (a restore or a seed) is silent.
//
// A window that closes (a plot or map window is removed from the store when it
// closes) is named by the title it had, never by its raw id, and when its
// closing leaves keyboard focus on <body> the next window in front takes it (UX
// pass 4 m-2), so a keyboard user does not start again from the top of the page.

import { useEffect, useRef } from "react";

import type { WindowLayoutV1, WindowRef } from "../../../lib/windowLayout/types";
import { isShown } from "../../../store/windowLayoutActions";
import { readingOrder } from "./layoutGeometry";
import { announce, describeChange, takeHeld, useAnnouncement } from "./layoutAnnounce";
import { takeFocusReturn } from "./focusReturn";
import { focusTitleBar } from "./useLayoutKeyboard";

/** Hand focus to the front-most shown window's title bar (else the toolbar) when it was lost to <body>. */
function refocusAfterClose(layout: WindowLayoutV1): void {
  const lost = !document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected;
  if (!lost) return;
  // A closing tool's opener beats the front window (it may already have been taken by the tool's own timer).
  const back = takeFocusReturn();
  if (back) {
    back.focus({ preventScroll: true });
    return;
  }
  // The floating window in front first, then the docked ones in reading order.
  const shown = (r: WindowRef) => isShown(layout, r);
  for (const ref of [...[...layout.z].reverse().filter(shown), ...readingOrder(layout, shown)]) if (focusTitleBar(ref)) return;
  document.querySelector<HTMLElement>(".qzk-wl-toolbar button")?.focus();
}

export default function LayoutAnnouncer({ layout, titleOf }: { layout: WindowLayoutV1; titleOf: (ref: WindowRef) => string }) {
  const prev = useRef(layout);
  const titles = useRef(titleOf);
  titles.current = titleOf;
  // The last title each window showed: a closed plot window is gone from the store, and titleOf then answers with its id.
  const seen = useRef(new Map<WindowRef, string>());
  useEffect(() => {
    const was = prev.current;
    const named = (ref: WindowRef) => {
      const live = titles.current(ref);
      return live === ref ? (seen.current.get(ref) ?? live) : live;
    };
    const text = was === layout ? null : describeChange(was, layout, named);
    const closed = was !== layout && Object.keys(was.placements).some((r) => was.placements[r as WindowRef]?.open && !layout.placements[r as WindowRef]?.open);
    for (const ref of Object.keys(layout.placements) as WindowRef[]) {
      const live = titles.current(ref);
      if (live !== ref) seen.current.set(ref, live);
    }
    prev.current = layout;
    // A gesture's own sentence (a cancelled move) replaces the diff's, once.
    const held = takeHeld();
    if (held ?? text) announce(held ?? text ?? "");
    if (closed) requestAnimationFrame(() => refocusAfterClose(layout));
  }, [layout]);
  // Leaving windows mode must not leave a sentence behind for the next host.
  useEffect(() => () => announce(""), []);
  const { n, text } = useAnnouncement();
  return (
    <div className="qz-sr-only" aria-live="polite" aria-atomic="true" data-testid="wl-live">
      <span key={n}>{text}</span>
    </div>
  );
}
