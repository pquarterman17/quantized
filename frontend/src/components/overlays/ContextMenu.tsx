// A lightweight right-click context menu. The host tracks `{x,y}` open state and
// renders <ContextMenu> at the cursor; the menu portals to <body> (so panel
// overflow can't clip it), clamps itself into the viewport, and closes on
// outside-click, Escape, scroll, resize, or after an item runs. Styling reuses
// the menubar popup tokens (`.qzk-menu-pop` / `.qzk-menu-item`). This is the
// parity surface for the MATLAB GUI's six uicontextmenus.
//
// Item variants (all backward-compatible — a flat `{label,run}`/`{separator}`
// list still renders exactly as before; types live in ./contextMenuTypes):
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
// Stacking: root 2100 / flyout 2101, above InteractionHints (1200) and .qz-tip (2000, platform.css); see ContextMenu.test.tsx's stacking test.
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
import { FlyoutBox, PopupBox } from "./ContextMenuBoxes";
import { appendContextHelp, type ContextMenuHelp } from "./contextMenuHelp";
import type { ContextMenuItem } from "./contextMenuTypes";

export type { ContextMenuItem, Swatch } from "./contextMenuTypes";

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  /** Optional one-line Help footer (see ./contextMenuHelp). */
  help?: ContextMenuHelp;
  onNavigateRoot?: (direction: -1 | 1) => void;
  returnFocus?: HTMLElement | null;
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
  onNavigateRoot?: (direction: -1 | 1) => void;
}

/** Renders one item list (root or a submenu). Owns which submenu is currently
 *  hovered/opened. `onClose` closes the WHOLE menu after any leaf action runs. */
function MenuList({ items, onClose, autoFocusFirst = false, onCollapse, menuRef, onNavigateRoot }: MenuListProps) {
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
        } else if (!onCollapse && onNavigateRoot) {
          e.preventDefault();
          e.stopPropagation();
          onNavigateRoot(1);
        }
        return;
      }
      case "ArrowLeft":
        if (onCollapse) {
          e.preventDefault();
          e.stopPropagation();
          onCollapse();
        } else if (onNavigateRoot) {
          e.preventDefault();
          e.stopPropagation();
          onNavigateRoot(-1);
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
                title={it.title}
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
            title={it.title}
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
            <span className="qzk-menu-item-end">
              {it.shortcutLabel && (
                <span className="qz-shortcut" aria-hidden="true">
                  {it.shortcutLabel}
                </span>
              )}
              {it.checked && (
                <span className="qzk-ctx-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function ContextMenu({ x, y, items, onClose, help, onNavigateRoot, returnFocus }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Captured once, synchronously, before the menu steals focus — GUI_INTERACTION
  // #8's "Esc returns focus to the invoking element" (a keyboard-opened row,
  // the "⋯" resting-cue button, or nothing for a plain mouse right-click).
  const [prevFocus] = useState<HTMLElement | null>(
    () => returnFocus ?? (document.activeElement as HTMLElement | null),
  );

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

  // The Help footer hands focus back to `prevFocus` before Help opens, so
  // closing Help lands on the object the menu was opened from.
  const visibleItems = appendContextHelp(items, help, prevFocus);
  return createPortal(
    <PopupBox x={x} y={y} boxRef={rootRef}>
      <MenuList items={visibleItems} onClose={onClose} menuRef={menuRef} onNavigateRoot={onNavigateRoot} />
    </PopupBox>,
    document.body,
  );
}
