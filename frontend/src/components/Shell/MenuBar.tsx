// Menu bar: click a title to open its dropdown (items are the same actions the
// ⌘K palette runs, grouped by `action.group`). Click-outside / Escape close it;
// hovering another title while one is open switches menus. A search chip on the
// right opens the palette. The File menu also lists Recent imports (#20); the
// Help menu surfaces Help-group actions (e.g. the keyboard-shortcuts sheet).

import { useEffect, useMemo, useRef, useState } from "react";

import { mergeCommands, PALETTE_LABEL, PALETTE_SHORTCUT, runAction, useCommands, type Action } from "../../store/commands";
import { reopenRecent } from "../../lib/reopenRecent";
import type { RecentFile } from "../../lib/recentFiles";
import { relativeTime } from "../../lib/recentFiles";
import { withSectionHeaders } from "../../lib/menuSections";
import { formatShortcut, isMacPlatform } from "../../lib/shortcuts";
import { useApp } from "../../store/useApp";

// Top-level menus and the action group each shows. "Help" is built in below.
// Order mirrors the design handoff's menubar (File · Edit · Data · Plot ·
// Insert · Analyze · Window · View · Help). Empty groups simply don't open.
// "Window" (MULTI_PLOT_PLAN item 5) has no entries in App.tsx's curated
// list — it's populated entirely by `useCommands().menuCommands` (see the
// merge below), published by `windows/useWindowCommands` — zero lines added
// to App.tsx. "Insert" (MAIN #27) is the NEW top-level menu this repo
// didn't have before — the drawn-shapes commands' second discoverability
// path alongside the plot's own dock flyout (`PlotToolbar`).
// Resolved once at module load — the host platform does not change.
const IS_MAC = isMacPlatform();

const MENUS: { label: string; group: string }[] = [
  { label: "File", group: "File" },
  { label: "Edit", group: "Edit" },
  { label: "Data", group: "Data" },
  { label: "Plot", group: "Plot" },
  { label: "Insert", group: "Insert" },
  { label: "Analyze", group: "Analyze" },
  { label: "Window", group: "Window" },
  { label: "View", group: "View" },
];


interface MenuBarProps {
  actions: Action[];
  onOpenPalette: () => void;
}

export default function MenuBar({ actions, onOpenPalette }: MenuBarProps) {
  const [open, setOpen] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const recent = useApp((s) => s.recent);
  const clearRecent = useApp((s) => s.clearRecent);
  // App's curated list PLUS anything published into the shared command
  // registry (e.g. the Window menu's commands — see MULTI_PLOT_PLAN item 5)
  // — the same merge the ⌘K palette does, so a menu entry and a palette
  // entry are always the same set.
  const menuCmds = useCommands((s) => s.menuCommands);
  const allActions = useMemo(() => mergeCommands(actions, menuCmds), [actions, menuCmds]);

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

  // MAIN #31: an entry imported through a native dialog carries a path and
  // reopens its TARGET; a browser-uploaded one still re-opens the picker,
  // because no path was ever knowable. reopenRecent owns the missing-vs-offline
  // decision — an unmounted share must not be treated as a deleted file.
  const reopen = (entry: RecentFile) => {
    setOpen(null);
    if (!entry.path) useApp.getState().setStatus(`re-select "${entry.name}" to import it`);
    void reopenRecent(useApp.getState(), entry);
  };
  const forget = (e: React.MouseEvent, name: string) => {
    // Removing a stale entry must not also re-import it.
    e.stopPropagation();
    useApp.getState().removeRecent(name);
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
        const items = allActions.filter((a) => a.group === m.group);
        const isFile = m.group === "File";
        return (
          <div key={m.label} className="qzk-menu-wrap">
            {title(m.label)}
            {open === m.label && (items.length > 0 || (isFile && recent.length > 0)) && (
              <div className="qzk-menu-pop">
                {/* #17: menus that declare `section` render sub-topic headers
                    (Analyze had grown to 17 flat items). Menus that don't set
                    it produce exactly one item row each, as before. */}
                {withSectionHeaders(items).map((row, i) =>
                  row.kind === "header" ? (
                    <div key={`h-${row.label}`}>
                      {i > 0 && <div className="qzk-menu-sep" />}
                      <div className="qzk-menu-label">{row.label}</div>
                    </div>
                  ) : (
                    <button
                      key={row.action.id}
                      className="qzk-menu-item"
                      onClick={() => {
                        setOpen(null);
                        // P3.4 slice 2: same chokepoint the palette uses —
                        // an async command (every File-menu export) now
                        // registers an in-flight signal for StatusBar.
                        runAction(row.action);
                      }}
                    >
                      <span>{row.action.label}</span>
                      {row.action.shortcut && (
                        <span className="qz-shortcut">{formatShortcut(row.action.shortcut, IS_MAC)}</span>
                      )}
                    </button>
                  ),
                )}
                {isFile && recent.length > 0 && (
                  <>
                    <div className="qzk-menu-sep" />
                    <div className="qzk-menu-label">Recent</div>
                    {recent.map((r) => (
                      <button
                        key={r.name}
                        className="qzk-menu-item"
                        title={
                          r.path
                            ? `${r.path} — reopens this file directly`
                            : `${r.name} — re-opens the import picker (no path was saved)`
                        }
                        onClick={() => reopen(r)}
                      >
                        <span className="qzk-menu-trunc">{r.name}</span>
                        <span className="qz-shortcut">{relativeTime(r.at, now)}</span>
                        <span
                          role="button"
                          tabIndex={-1}
                          aria-label={`Remove ${r.name} from recent`}
                          title="Remove from recent"
                          className="qz-shortcut"
                          onClick={(e) => forget(e, r.name)}
                        >
                          ✕
                        </span>
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
            {allActions
              .filter((a) => a.group === "Help")
              .map((a) => (
                <button
                  key={a.id}
                  className="qzk-menu-item"
                  onClick={() => {
                    setOpen(null);
                    runAction(a);
                  }}
                >
                  <span>{a.label}</span>
                  {a.shortcut && <span className="qz-shortcut">{formatShortcut(a.shortcut, IS_MAC)}</span>}
                </button>
              ))}
            <button
              className="qzk-menu-item"
              onClick={() => {
                setOpen(null);
                onOpenPalette();
              }}
            >
              <span>{PALETTE_LABEL}</span>
              <span className="qz-shortcut">{formatShortcut(PALETTE_SHORTCUT, IS_MAC)}</span>
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
        data-tip={PALETTE_LABEL}
        data-tip-key={formatShortcut(PALETTE_SHORTCUT, IS_MAC)}
      >
        <span>⌕</span>
        <span>Search…</span>
        <span className="qz-shortcut">{formatShortcut(PALETTE_SHORTCUT, IS_MAC)}</span>
      </span>
    </nav>
  );
}
