// Ported from fermiviewer frontend/src/components/overlays/TooltipLayer.tsx.
// One delegated listener shows a glass tooltip after a dwell for any element
// with [data-tip] (+ optional [data-tip-key] shortcut). Mounted once at root.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface Tip {
  label: string;
  hint: string | null;
  x: number;
  y: number;
  below: boolean;
}

const DWELL_MS = 350;

export default function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };
    const onOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-tip]");
      if (!el) return;
      const label = el.getAttribute("data-tip");
      if (!label) return;
      const hint = el.getAttribute("data-tip-key");
      const rect = el.getBoundingClientRect();
      clear();
      timer = setTimeout(() => {
        const below = rect.top < 90; // flip below near the top edge
        setTip({
          label,
          hint,
          x: rect.left + rect.width / 2,
          y: below ? rect.bottom + 8 : rect.top - 8,
          below,
        });
      }, DWELL_MS);
    };
    const onOut = () => {
      clear();
      setTip(null);
    };
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("mousedown", onOut);
    return () => {
      clear();
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("mousedown", onOut);
    };
  }, []);

  if (!tip) return null;
  return createPortal(
    <div
      className="qz-tip"
      style={{
        left: tip.x,
        top: tip.y,
        transform: tip.below ? "translate(-50%, 0)" : "translate(-50%, -100%)",
      }}
    >
      <span>{tip.label}</span>
      {tip.hint && <kbd className="qz-tip-key">{tip.hint}</kbd>}
    </div>,
    document.body,
  );
}
