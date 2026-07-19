// Ported from fermiviewer frontend/src/components/overlays/TooltipLayer.tsx.
// One delegated listener shows a glass tooltip after a dwell for any element
// with [data-tip] (+ optional [data-tip-desc] one-line behaviour and
// [data-tip-key] keyboard shortcut). Mounted once at root.
//
// GUI_INTERACTION_PLAN #7 (plot-toolbar legibility): extended from the
// original single-line {label, hint} shape to a bold-NAME + one-line-
// BEHAVIOUR + optional-SHORTCUT tooltip, and from hover-only to hover-OR-
// focus (focusin/focusout, delegated the same way as mouseover/mouseout) so
// keyboard users tabbing through icon-only buttons get the same information
// sighted mouse users do. Escape dismisses immediately, without stopping
// propagation, so it never steals Escape from a dialog/menu that's also
// listening for it.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useHelp } from "../../store/help";

interface Tip {
  name: string;
  desc: string | null;
  hint: string | null;
  x: number;
  y: number;
  below: boolean;
}

const DWELL_MS = 400;

function readTip(el: HTMLElement): { name: string; desc: string | null; hint: string | null } | null {
  const name = el.getAttribute("data-tip");
  if (!name) return null;
  return { name, desc: el.getAttribute("data-tip-desc"), hint: el.getAttribute("data-tip-key") };
}

export default function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  // "What is this?" mode reveals help INSTANTLY. Read through a ref so the one
  // delegated listener below sees the current value without re-subscribing.
  const whatIsThis = useHelp((s) => s.whatIsThis);
  const whatIsThisRef = useRef(whatIsThis);
  whatIsThisRef.current = whatIsThis;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };
    const schedule = (el: HTMLElement) => {
      const body = readTip(el);
      if (!body) return;
      const rect = el.getBoundingClientRect();
      clear();
      const show = () => {
        const below = rect.top < 90; // flip below near the top edge
        setTip({
          ...body,
          x: rect.left + rect.width / 2,
          y: below ? rect.bottom + 8 : rect.top - 8,
          below,
        });
      };
      if (whatIsThisRef.current) show();
      else timer = setTimeout(show, DWELL_MS);
    };
    const dismiss = () => {
      clear();
      setTip(null);
    };
    const onOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-tip]");
      if (el) schedule(el);
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-tip]");
      if (el) schedule(el);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", dismiss);
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", dismiss);
    document.addEventListener("keydown", onKey);
    return () => {
      clear();
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", dismiss);
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", dismiss);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!tip) return null;
  return createPortal(
    <div
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
