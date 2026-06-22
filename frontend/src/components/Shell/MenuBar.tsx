// Menu bar: click a title to open its dropdown (items are the same actions the
// ⌘K palette runs, grouped by `action.group`). Click-outside / Escape close it;
// hovering another title while one is open switches menus. A search chip on the
// right opens the palette.

import { useEffect, useRef, useState } from "react";

import type { Action } from "../../store/commands";

// Top-level menus and the action group each shows. "Help" is built in below.
const MENUS: { label: string; group: string }[] = [
  { label: "File", group: "File" },
  { label: "View", group: "View" },
  { label: "Analyze", group: "Analyze" },
];

interface MenuBarProps {
  actions: Action[];
  onOpenPalette: () => void;
}

export default function MenuBar({ actions, onOpenPalette }: MenuBarProps) {
  const [open, setOpen] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function title(label: string) {
    const isOpen = open === label;
    return (
      <span
        className={`qzk-menu${isOpen ? " open" : ""}`}
        onClick={() => setOpen(isOpen ? null : label)}
        // Once a menu is open, hovering siblings switches to them (menubar feel).
        onMouseEnter={() => open && setOpen(label)}
      >
        {label}
      </span>
    );
  }

  return (
    <nav className="qzk-menubar" ref={navRef}>
      {MENUS.map((m) => {
        const items = actions.filter((a) => a.group === m.group);
        return (
          <div key={m.label} className="qzk-menu-wrap">
            {title(m.label)}
            {open === m.label && items.length > 0 && (
              <div className="qzk-menu-pop">
                {items.map((a) => (
                  <button
                    key={a.id}
                    className="qzk-menu-item"
                    onClick={() => {
                      setOpen(null);
                      a.run();
                    }}
                  >
                    <span>{a.label}</span>
                    {a.shortcut && <span className="qz-shortcut">{a.shortcut}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className="qzk-menu-wrap">
        {title("Help")}
        {open === "Help" && (
          <div className="qzk-menu-pop">
            <button
              className="qzk-menu-item"
              onClick={() => {
                setOpen(null);
                onOpenPalette();
              }}
            >
              <span>Command palette</span>
              <span className="qz-shortcut">⌘K</span>
            </button>
            <a
              className="qzk-menu-item"
              href="https://github.com/pquarterman17/quantized"
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(null)}
            >
              <span>About quantized ↗</span>
            </a>
          </div>
        )}
      </div>

      <span className="qzk-spacer" />
      <span
        className="qzk-search"
        onClick={onOpenPalette}
        data-tip="Command palette"
        data-tip-key="⌘K"
      >
        <span>⌕</span>
        <span>Search…</span>
        <span className="qz-shortcut">⌘K</span>
      </span>
    </nav>
  );
}
