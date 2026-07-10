// A lightweight right-click context menu. The host tracks `{x,y}` open state and
// renders <ContextMenu> at the cursor; the menu portals to <body> (so panel
// overflow can't clip it), clamps itself into the viewport, and closes on
// outside-click, Escape, scroll, resize, or after an item runs. Styling reuses
// the menubar popup tokens (`.qzk-menu-pop` / `.qzk-menu-item`). This is the
// parity surface for the MATLAB GUI's six uicontextmenus.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ContextMenuItem =
  | { separator: true }
  | { label: string; run: () => void; disabled?: boolean; danger?: boolean };

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Once measured, shift the menu so it never spills past the viewport edges.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    const nx = x + r.width + pad > window.innerWidth ? Math.max(pad, window.innerWidth - r.width - pad) : x;
    const ny = y + r.height + pad > window.innerHeight ? Math.max(pad, window.innerHeight - r.height - pad) : y;
    setPos({ x: nx, y: ny });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="qzk-menu-pop qzk-ctx"
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 1000 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        "separator" in it ? (
          <div key={`sep-${i}`} className="qzk-ctx-sep" />
        ) : (
          <button
            key={it.label}
            className={`qzk-menu-item${it.danger ? " danger" : ""}`}
            disabled={it.disabled}
            onClick={(e) => {
              // `createPortal` moves the DOM node to <body>, but a React
              // synthetic event still bubbles through the REACT tree (the
              // menu's JSX parent — e.g. a Library row) regardless of DOM
              // placement. Without this, an item click also fires whatever
              // onClick the host it's rendered inside owns (harmless when
              // that handler happened to do the same thing the menu item
              // did, but a real bug once they can diverge — WORKSHEET_PLAN
              // item 15's "Plot (make active)" vs. a plain row click is the
              // case that surfaced it).
              e.stopPropagation();
              onClose();
              it.run();
            }}
          >
            <span>{it.label}</span>
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
