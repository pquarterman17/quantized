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
//
// Flyout positioning is ANCHORED (position:absolute against the hovered row),
// never viewport-fixed: `.qzk-menu-pop`'s `backdrop-filter` makes every popup a
// containing block for fixed descendants (CSS spec), so viewport coords inside
// a menu silently re-resolve against the popup box — the 2026-07-11 bug where
// scale flyouts opened "way off" and closed before the pointer could reach
// them. Row-anchoring is immune; a layout effect only FLIPS the side / shifts
// vertically when the flyout would overflow the viewport.
//
// GUI_INTERACTION #8: keyboard-complete — `role="menu"`/`menuitem`/
// `menuitemcheckbox` + `aria-disabled`; ArrowUp/Down cycle (wrapping),
// Home/End jump, a letter type-ahead-jumps; ArrowRight opens a submenu +
// focuses its first item, ArrowLeft collapses back to the trigger. Enter/
// Space are mostly FREE (real `<button>`s already fire `onClick`) — the
// index math for the rest lives in lib/menuKeyboardNav.ts (pure, unit-
// tested). Esc still closes the WHOLE menu (unchanged) and now ALSO returns
// focus to whatever was focused when the menu opened. The menu container
// grabs focus on open (no pre-highlighted item, matching native OS menus)
// so the FIRST arrow key already navigates. Swatch grids stay mouse-first
// (like a native colour picker); a hover-opened submenu doesn't steal focus.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { edgeFocusableIndex, nextFocusableIndex, typeaheadIndex } from "../../lib/menuKeyboardNav";

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

/** A nested flyout, anchored to its `.qzk-ctx-subwrap` row (position:absolute
 *  — see the module header for why fixed/viewport coords are forbidden here).
 *  Opens to the right overlapping the parent by 3px so the pointer can travel
 *  into it without a mouseleave gap; flips to the left / shifts up only when
 *  the viewport would clip it. */
function FlyoutBox({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<"right" | "left">("right");
  const [shiftY, setShiftY] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return; // jsdom / not laid out yet
    const pad = 8;
    if (r.right > window.innerWidth - pad) setSide("left");
    const overflowY = r.bottom - (window.innerHeight - pad);
    if (overflowY > 0) setShiftY(-overflowY);
  }, []);
  const sidePos =
    side === "right"
      ? { left: "calc(100% - 3px)" }
      : { right: "calc(100% - 3px)" };
  return (
    <div
      ref={ref}
      className="qzk-menu-pop qzk-ctx"
      style={{ position: "absolute", top: -4 + shiftY, zIndex: 1001, ...sidePos }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}

interface MenuListProps {
  items: ContextMenuItem[];
  onClose: () => void;
  /** A NEWLY MOUNTED submenu focuses its own first item when true (an
   *  explicit open — ArrowRight/click/Enter), not for a hover-preview open.
   *  Unused at the root — <ContextMenu> focuses the root container itself. */
  autoFocusFirst?: boolean;
  /** Submenu-only: ArrowLeft calls this to close the flyout and refocus the
   *  item that opened it. Absent at the root (nothing further out). */
  onCollapse?: () => void;
  /** Root-only: lets <ContextMenu> focus this level's container on mount. */
  menuRef?: React.Ref<HTMLDivElement>;
}

/** Renders one item list (root or a submenu). Owns which submenu is currently
 *  hovered/opened. `onClose` closes the WHOLE menu after any leaf action runs. */
function MenuList({ items, onClose, autoFocusFirst = false, onCollapse, menuRef }: MenuListProps) {
  const [openSub, setOpenSub] = useState<{ i: number; via: "mouse" | "key" } | null>(null);
  const itemRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const containerRef = useRef<HTMLDivElement>(null);

  // The index-arithmetic (which item is next for Up/Down/Home/End/type-ahead)
  // is pure and lives in lib/menuKeyboardNav.ts; this is just the DOM glue —
  // "which item currently HAS focus" and "move focus to index i".
  const focusAt = (i: number | null) => {
    if (i != null) itemRefs.current[i]?.focus();
  };
  const curFocused = (): number =>
    Object.keys(itemRefs.current)
      .map(Number)
      .find((k) => itemRefs.current[k] === document.activeElement) ?? -1;

  useLayoutEffect(() => {
    if (autoFocusFirst) focusAt(edgeFocusableIndex(items, "start"));
    // Only on mount — a later re-render must not re-steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusAt(nextFocusableIndex(items, curFocused(), 1));
        return;
      case "ArrowUp":
        e.preventDefault();
        focusAt(nextFocusableIndex(items, curFocused(), -1));
        return;
      case "Home":
        e.preventDefault();
        focusAt(edgeFocusableIndex(items, "start"));
        return;
      case "End":
        e.preventDefault();
        focusAt(edgeFocusableIndex(items, "end"));
        return;
      case "ArrowRight": {
        const idx = curFocused();
        const it = idx >= 0 ? items[idx] : undefined;
        if (it && "submenu" in it && !it.disabled) {
          e.preventDefault();
          e.stopPropagation();
          setOpenSub({ i: idx, via: "key" });
        }
        return;
      }
      case "ArrowLeft":
        if (onCollapse) {
          e.preventDefault();
          e.stopPropagation();
          onCollapse();
        }
        return;
      default:
        if (e.key.length === 1 && /[a-z0-9]/i.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
          focusAt(typeaheadIndex(items, curFocused(), e.key));
        }
    }
  };

  return (
    <div
      ref={(node) => {
        containerRef.current = node;
        if (typeof menuRef === "function") menuRef(node);
        else if (menuRef) (menuRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }}
      role="menu"
      tabIndex={-1}
      style={{ display: "contents" }}
      onKeyDown={onKeyDown}
    >
      {items.map((it, i) => {
        if ("separator" in it) return <div key={`sep-${i}`} className="qzk-ctx-sep" role="separator" />;
        if ("header" in it)
          return (
            <div key={`h-${i}`} className="qzk-ctx-header" role="presentation">
              {it.header}
            </div>
          );
        if ("swatches" in it)
          return (
            <div
              key={`sw-${i}`}
              className="qzk-ctx-swatches"
              role="group"
              aria-label="Colours"
              onMouseEnter={() => setOpenSub(null)}
            >
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
              onMouseEnter={() => !it.disabled && setOpenSub({ i, via: "mouse" })}
              onMouseLeave={() => setOpenSub((s) => (s?.i === i ? null : s))}
            >
              <button
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                className="qzk-menu-item qzk-ctx-hassub"
                disabled={it.disabled}
                role="menuitem"
                aria-haspopup="true"
                aria-expanded={openSub?.i === i}
                aria-disabled={it.disabled || undefined}
                onClick={() => setOpenSub((s) => (s?.i === i ? null : { i, via: "key" }))}
              >
                <span>{it.label}</span>
                <span className="qzk-ctx-arrow" aria-hidden="true">
                  ›
                </span>
              </button>
              {openSub?.i === i && (
                <FlyoutBox>
                  <MenuList
                    items={it.submenu}
                    onClose={onClose}
                    autoFocusFirst={openSub.via === "key"}
                    onCollapse={() => {
                      setOpenSub(null);
                      itemRefs.current[i]?.focus();
                    }}
                  />
                </FlyoutBox>
              )}
            </div>
          );
        return (
          <button
            key={it.label}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            className={`qzk-menu-item${it.danger ? " danger" : ""}`}
            disabled={it.disabled}
            role={it.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={it.checked === undefined ? undefined : it.checked}
            aria-disabled={it.disabled || undefined}
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
    </div>
  );
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Captured once, synchronously, before the menu steals focus — GUI_INTERACTION
  // #8's "Esc returns focus to the invoking element" (a keyboard-opened row,
  // the "⋯" resting-cue button, or nothing for a plain mouse right-click).
  const [prevFocus] = useState<HTMLElement | null>(() => document.activeElement as HTMLElement | null);

  useLayoutEffect(() => {
    // Grab focus onto the menu itself (not any one item) as soon as it opens
    // — mirrors native OS context menus, where the very first arrow key
    // already navigates without a preceding "wake up" keypress.
    menuRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      // Flyouts are DOM descendants of the root box, so this single guard
      // covers the whole (possibly nested) menu tree.
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      // GUI_INTERACTION #9: an open menu OWNS Escape — stop it here so it
      // never also reaches a window-level consumer underneath (e.g. the
      // plot-tool Esc handler reverting the active tool to Pointer as an
      // unrelated side effect of closing this menu).
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        // GUI_INTERACTION #8: return focus to whatever opened the menu.
        prevFocus?.focus?.();
      }
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
  }, [onClose, prevFocus]);

  return createPortal(
    <PopupBox x={x} y={y} boxRef={rootRef}>
      <MenuList items={items} onClose={onClose} menuRef={menuRef} />
    </PopupBox>,
    document.body,
  );
}
