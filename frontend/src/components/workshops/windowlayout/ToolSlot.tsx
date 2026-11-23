// Adopt an analysis tool's DOM node (WORKSPACE_LAYOUT_PLAN P4): the node
// LayoutToolWindow portals the tool's header or body into moves here, and goes
// back to its owner on unmount, so re-docking never remounts the workshop.

import { useLayoutEffect, useRef } from "react";

/** Adopt a tool's DOM node (move it here; it goes back to its owner on unmount). */
export default function ToolSlot({ el, className }: { el: HTMLElement; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    box.appendChild(el);
    return () => {
      if (el.parentNode === box) box.removeChild(el);
    };
  }, [el]);
  return <div ref={ref} className={className} />;
}
