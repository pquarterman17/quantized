import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

import type { Tip } from "./TooltipLayer";

/** The portal-only half of TooltipLayer, loaded on the first actual tip. */
export default function TooltipBubble({ tip }: { tip: Tip }) {
  const tipRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el) return;
    el.style.marginLeft = "";
    const r = el.getBoundingClientRect();
    el.style.marginLeft = `${Math.min(0, window.innerWidth - 8 - r.right) || Math.max(0, 8 - r.left)}px`;
  }, [tip]);

  return createPortal(
    <div
      ref={tipRef}
      className="qz-tip"
      role="tooltip"
      style={{
        left: tip.x,
        top: tip.y,
        transform: tip.below ? "translate(-50%, 0)" : "translate(-50%, -100%)",
      }}
    >
      <div className="qz-tip-head">
        <span className="qz-tip-name">{tip.name}</span>
        {tip.hint && <kbd className="qz-tip-key">{tip.hint}</kbd>}
      </div>
      {tip.desc && <div className="qz-tip-desc">{tip.desc}</div>}
    </div>,
    document.body,
  );
}
