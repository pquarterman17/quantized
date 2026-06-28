// Menu bar: click a title to open its dropdown (items are the same actions the
// ⌘K palette runs, grouped by `action.group`). Click-outside / Escape close it;
// hovering another title while one is open switches menus. A search chip on the
// right opens the palette. The File menu also lists Recent imports (#20); the
// Help menu surfaces Help-group actions (e.g. the keyboard-shortcuts sheet).

import { useEffect, useRef, useState } from "react";

import type { Action } from "../../store/commands";
import { openFilePicker } from "../../lib/openFilePicker";
import { relativeTime } from "../../lib/recentFiles";
import { useApp } from "../../store/useApp";

// Top-level menus and the action group each shows. "Help" is built in below.
// Order mirrors the design handoff's menubar (File · Edit · Data · Plot ·
// Analyze · View · Help). Empty groups simply don't open.
const MENUS: { label: string; group: string }[] = [
  { label: "File", group: "File" },
  { label: "Edit", group: "Edit" },
  { label: "Data", group: "Data" },
  { label: "Plot", group: "Plot" },
  { label: "Analyze", group: "Analyze" },
  { label: "View", group: "View" },
];

const ACCEPT = ".dat,.csv,.txt,.xrdml,.raw,.refl,.pnr,.datA,.cif,.xlsx,.xls";

interface MenuBarProps {
  actions: Action[];
  onOpenPalette: () => void;
}

export default function MenuBar({ actions, onOpenPalette }: MenuBarProps) {
  const [open, setOpen] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const recent = useApp((s) => s.recent);
  const clearRecent = useApp((s) => s.clearRecent);
  const importFiles = useApp((s) => s.importFiles);

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

  // A browser picker can't re-open a file by path, so a Recent entry re-opens the
  // import dialog (with a hint of which file you last used).
  const reopen = (name: string) => {
    setOpen(null);
    useApp.getState().setStatus(`re-select "${name}" to import it`);
    openFilePicker((files) => void importFiles(files), ACCEPT);
  };

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

  const now = Date.now();

  return (
    <nav className="qzk-menubar" ref={navRef}>
      {MENUS.map((m) => {
        const items = actions.filter((a) => a.group === m.group);
        const isFile = m.group === "File";
        return (
          <div key={m.label} className="qzk-menu-wrap">
            {title(m.label)}
            {open === m.label && (items.length > 0 || (isFile && recent.length > 0)) && (
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
                {isFile && recent.length > 0 && (
                  <>
                    <div className="qzk-menu-sep" />
                    <div className="qzk-menu-label">Recent</div>
                    {recent.map((r) => (
                      <button
                        key={r.name}
                        className="qzk-menu-item"
                        title={`${r.name} — re-opens the import picker`}
                        onClick={() => reopen(r.name)}
                      >
                        <span className="qzk-menu-trunc">{r.name}</span>
                        <span className="qz-shortcut">{relativeTime(r.at, now)}</span>
                      </button>
                    ))}
                    <button
                      className="qzk-menu-item"
                      onClick={() => {
                        setOpen(null);
                        clearRecent();
                      }}
                    >
                      <span>Clear recent</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="qzk-menu-wrap">
        {title("Help")}
        {open === "Help" && (
          <div className="qzk-menu-pop">
            {actions
              .filter((a) => a.group === "Help")
              .map((a) => (
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
