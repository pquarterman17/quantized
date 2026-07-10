// A lightweight right-click context menu. The host tracks `{x,y}` open state and
// renders <ContextMenu> at the cursor; the menu portals to <body> (so panel
// overflow can't clip it), clamps itself into the viewport, and closes on
// outside-click, Escape, scroll, resize, or after an item runs. Styling reuses
// the menubar popup tokens (`.qzk-menu-pop` / `.qzk-menu-item`). This is the
// parity surface for the MATLAB GUI's six uicontextmenus.
//
// Item variants (all backward-compatible — a flat `{label,run}`/`{separator}`
// list still renders exactly as before):
//   { separator }            — a divider rule
//   { header }               — a non-interactive section label
//   { swatches }             — a compact horizontal colour-swatch row
//   { label, run, checked? } — a normal action (optional trailing ✓ for toggles)
//   { label, submenu }       — a nested flyout (opens on hover to the right;
//                              rendered as a DOM child so the root's
//                              outside-click guard still contains it)

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** One swatch in a `{ swatches }` colour row. */
export interface Swatch {
  key: string;
  title: string;
  /** CSS colour for the swatch fill (e.g. "var(--series-3)", "#000000"). */
  css: string;
  active?: boolean;
  run: () => void;
}

export type ContextMenuItem =
  | { separator: true }
  | { header: string }
  | { swatches: Swatch[] }
  | { label: string; submenu: ContextMenuItem[]; disabled?: boolean }
  | { label: string; run: () => void; disabled?: boolean; danger?: boolean; checked?: boolean };

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/** A positioned, self-clamping popup box. Used for the root menu and each
 *  nested flyout; both portal-free flyouts stay DOM descendants of the root so
 *  a single outside-click guard covers the whole tree. */
function PopupBox({
  x,
  y,
  children,
  boxRef,
}: {
  x: number;
  y: number;
  children: React.ReactNode;
  boxRef?: React.Ref<HTMLDivElement>;
}) {
  const localRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = localRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    const nx = x + r.width + pad > window.innerWidth ? Math.max(pad, window.innerWidth - r.width - pad) : x;
    const ny = y + r.height + pad > window.innerHeight ? Math.max(pad, window.innerHeight - r.height - pad) : y;
    setPos({ x: nx, y: ny });
  }, [x, y]);
  return (
    <div
      ref={(node) => {
        localRef.current = node;
        if (typeof boxRef === "function") boxRef(node);
        else if (boxRef) (boxRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }}
      className="qzk-menu-pop qzk-ctx"
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 1000 }}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        // `createPortal` moves the DOM node to <body>, but a React synthetic
        // event still bubbles through the REACT tree (the menu's JSX parent —
        // e.g. a Library row) regardless of DOM placement. Item handlers have
        // already run by the time the event bubbles up here, so stopping it
        // at the popup root prevents an item click from ALSO firing the host
        // row's onClick (a real bug once the two can diverge — the
        // "Plot (make active)" menu item vs. a plain row click).
        e.stopPropagation();
      }}
    >
      {children}
    </div>
  );
}

/** Renders one item list (root or a submenu). Owns which submenu is currently
 *  hovered-open. `onClose` closes the WHOLE menu after any leaf action runs. */
function MenuList({ items, onClose }: { items: ContextMenuItem[]; onClose: () => void }) {
  const [openSub, setOpenSub] = useState<number | null>(null);
  const anchors = useRef<Record<number, HTMLElement | null>>({});
  const [subXY, setSubXY] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const openFlyout = (i: number) => {
    const el = anchors.current[i];
    if (el) {
      const r = el.getBoundingClientRect();
      setSubXY({ x: r.right - 3, y: r.top - 4 });
    }
    setOpenSub(i);
  };

  return (
    <>
      {items.map((it, i) => {
        if ("separator" in it) return <div key={`sep-${i}`} className="qzk-ctx-sep" />;
        if ("header" in it)
          return (
            <div key={`h-${i}`} className="qzk-ctx-header">
              {it.header}
            </div>
          );
        if ("swatches" in it)
          return (
            <div key={`sw-${i}`} className="qzk-ctx-swatches" onMouseEnter={() => setOpenSub(null)}>
              {it.swatches.map((sw) => (
                <button
                  key={sw.key}
                  className={`qzk-ctx-swatch${sw.active ? " active" : ""}`}
                  title={sw.title}
                  aria-pressed={sw.active}
                  style={{ background: sw.css }}
                  onClick={() => {
                    onClose();
                    sw.run();
                  }}
                />
              ))}
            </div>
          );
        if ("submenu" in it)
          return (
            <div
              key={it.label}
              className="qzk-ctx-subwrap"
              onMouseEnter={() => !it.disabled && openFlyout(i)}
              onMouseLeave={() => setOpenSub((s) => (s === i ? null : s))}
            >
              <button
                ref={(el) => {
                  anchors.current[i] = el;
                }}
                className="qzk-menu-item qzk-ctx-hassub"
                disabled={it.disabled}
                onClick={() => (openSub === i ? setOpenSub(null) : openFlyout(i))}
              >
                <span>{it.label}</span>
                <span className="qzk-ctx-arrow" aria-hidden="true">
                  ›
                </span>
              </button>
              {openSub === i && (
                <PopupBox x={subXY.x} y={subXY.y}>
                  <MenuList items={it.submenu} onClose={onClose} />
                </PopupBox>
              )}
            </div>
          );
        return (
          <button
            key={it.label}
            ref={(el) => {
              anchors.current[i] = el;
            }}
            className={`qzk-menu-item${it.danger ? " danger" : ""}`}
            disabled={it.disabled}
            onMouseEnter={() => setOpenSub(null)}
            onClick={() => {
              onClose();
              it.run();
            }}
          >
            <span>{it.label}</span>
            {it.checked && (
              <span className="qzk-ctx-check" aria-hidden="true">
                ✓
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      // Flyouts are DOM descendants of the root box, so this single guard
      // covers the whole (possibly nested) menu tree.
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
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
    <PopupBox x={x} y={y} boxRef={rootRef}>
      <MenuList items={items} onClose={onClose} />
    </PopupBox>,
    document.body,
  );
}
