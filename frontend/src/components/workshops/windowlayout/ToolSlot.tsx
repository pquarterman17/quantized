// Adopt an analysis tool's DOM node (WORKSPACE_LAYOUT_PLAN P4): the node
// LayoutToolWindow portals the tool's header or body into moves here, and goes
// back to its owner on unmount, so re-docking never remounts the workshop.

import { useLayoutEffect, useRef } from "react";

/** Adopt a tool's DOM node (move it here; it goes back to its owner on unmount).
 *  The node is a React portal of the TOOL's tree, so React events inside it never
 *  reach the frame around it: `onActivate` gets a native pointerdown instead, for
 *  the frame to come forward or take focus as a click anywhere in it would. */
export default function ToolSlot({ el, className, onActivate }: { el: HTMLElement; className: string; onActivate?: (box: HTMLElement) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const activate = useRef(onActivate);
  useLayoutEffect(() => {
    activate.current = onActivate;
  });
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    box.appendChild(el);
    const down = () => activate.current?.(box);
    box.addEventListener("pointerdown", down, true);
    return () => {
      box.removeEventListener("pointerdown", down, true);
      if (el.parentNode === box) box.removeChild(el);
    };
  }, [el]);
  return <div ref={ref} className={className} />;
}
