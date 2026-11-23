// The layout's polite live region and the announcer that feeds it: whenever a
// window docks, floats or closes (whatever caused it) the one-sentence change
// is announced. The first layout (a restore or a seed) is silent.

import { useEffect, useRef } from "react";

import type { WindowLayoutV1, WindowRef } from "../../../lib/windowLayout/types";
import { announce, describeChange, useAnnouncement } from "./layoutAnnounce";

export default function LayoutAnnouncer({ layout, titleOf }: { layout: WindowLayoutV1; titleOf: (ref: WindowRef) => string }) {
  const prev = useRef(layout);
  const titles = useRef(titleOf);
  titles.current = titleOf;
  useEffect(() => {
    const text = prev.current === layout ? null : describeChange(prev.current, layout, titles.current);
    prev.current = layout;
    if (text) announce(text);
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
