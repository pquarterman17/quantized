import { useEffect, useMemo, useRef, useState } from "react";

import ContextMenu, { type ContextMenuItem } from "../overlays/ContextMenu";
import { reopenRecent } from "../../lib/reopenRecent";
import {
  recentParentLabel,
  relativeTime,
  type RecentFile,
} from "../../lib/recentFiles";
import { formatShortcut, isMacPlatform } from "../../lib/shortcutFormat";
import {
  mergeCommands,
  PALETTE_LABEL,
  PALETTE_SHORTCUT,
  useCommands,
  type Action,
} from "../../store/commands";
import { useApp } from "../../store/useApp";

const IS_MAC = isMacPlatform();
const MENUS = [
  "File",
  "Edit",
  "Data",
  "Plot",
  "Insert",
  "Analyze",
  "Window",
  "View",
  "Help",
] as const;
type MenuBuilder = typeof import("./appMenuModel").buildAppMenuItems;
let menuModelPromise: Promise<MenuBuilder> | null = null;

function loadMenuModel(): Promise<MenuBuilder> {
  menuModelPromise ??= import("./appMenuModel").then(
    (module) => module.buildAppMenuItems,
  );
  return menuModelPromise;
}

interface OpenMenu {
  label: string;
  x: number;
  y: number;
}

interface MenuBarProps {
  actions: Action[];
  onOpenPalette: () => void;
}

function recentLabel(entry: RecentFile, now: number): string {
  const parent = entry.path ? ` — ${recentParentLabel(entry.path)}` : "";
  return `${entry.name}${parent} · ${relativeTime(entry.at, now)}`;
}

export default function MenuBar({ actions, onOpenPalette }: MenuBarProps) {
  const [open, setOpen] = useState<OpenMenu | null>(null);
  const [focusedMenu, setFocusedMenu] = useState<string>(MENUS[0]);
  const [buildMenuItems, setBuildMenuItems] = useState<MenuBuilder | null>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const recent = useApp((s) => s.recent);
  const clearRecent = useApp((s) => s.clearRecent);
  const menuCmds = useCommands((s) => s.menuCommands);
  const allActions = useMemo(
    () => mergeCommands(actions, menuCmds),
    [actions, menuCmds],
  );
  const format = (shortcut: string) => formatShortcut(shortcut, IS_MAC);
  const warmMenuModel = () => {
    if (!buildMenuItems)
      void loadMenuModel().then((builder) => setBuildMenuItems(() => builder));
  };

  // Start the small menu-model chunk as soon as the persistent shell mounts.
  // Pointer/focus warming remains as a fallback, but cannot be the only path:
  // a fast click (or an automated click that does not dwell on the trigger)
  // can otherwise set aria-expanded while there are still no items to render.
  useEffect(() => {
    void loadMenuModel().then((builder) => setBuildMenuItems(() => builder));
  }, []);

  const positionFor = (label: string): OpenMenu | null => {
    const trigger = buttonRefs.current[label];
    if (!trigger) return null;
    const rect = trigger.getBoundingClientRect();
    return { label, x: rect.left, y: rect.bottom + 2 };
  };

  const openMenu = (label: string) => {
    warmMenuModel();
    if (label === "Help")
      void import("../../store/diagnostics").catch(() => {});
    const next = positionFor(label);
    if (next) setOpen(next);
  };

  const moveTopLevel = (from: string, direction: -1 | 1, keepOpen: boolean) => {
    const current = MENUS.indexOf(from as (typeof MENUS)[number]);
    const index = (current + direction + MENUS.length) % MENUS.length;
    const label = MENUS[index];
    setFocusedMenu(label);
    buttonRefs.current[label]?.focus();
    if (keepOpen) openMenu(label);
  };

  const reopen = (entry: RecentFile) => {
    if (!entry.path)
      useApp.getState().setStatus(`re-select "${entry.name}" to import it`);
    void reopenRecent(useApp.getState(), entry);
  };

  const recentItems = (): ContextMenuItem[] => {
    if (!recent.length) return [];
    const now = Date.now();
    return [
      { separator: true },
      {
        label: "Recent",
        submenu: recent.map((entry) => ({
          label: recentLabel(entry, now),
          title: entry.path ?? `Re-open the import picker for ${entry.name}`,
          run: () => reopen(entry),
        })),
      },
      {
        label: "Manage recent",
        submenu: [
          ...recent.map((entry) => ({
            label: `Remove ${entry.name}`,
            title:
              "Remove this entry from Recent without deleting its source file",
            run: () => useApp.getState().removeRecent(entry),
          })),
          { separator: true } as const,
          { label: "Clear recent", run: clearRecent },
        ],
      },
    ];
  };

  const itemsFor = (label: string): ContextMenuItem[] => {
    if (!buildMenuItems) return [];
    if (label === "Help") {
      const help = buildMenuItems(
        "Help",
        allActions.filter((action) => action.group === "Help"),
        format,
      );
      return [
        ...help,
        { separator: true },
        {
          label: PALETTE_LABEL,
          shortcutLabel: format(PALETTE_SHORTCUT),
          run: onOpenPalette,
        },
        {
          label: "About Quantized ↗",
          run: () =>
            window.open(
              "https://github.com/pquarterman17/quantized",
              "_blank",
              "noopener,noreferrer",
            ),
        },
      ];
    }
    const items = buildMenuItems(
      label,
      allActions.filter((action) => action.group === label),
      format,
    );
    return label === "File" ? [...items, ...recentItems()] : items;
  };

  const openItems = open ? itemsFor(open.label) : [];

  return (
    <nav
      className="qzk-menubar"
      role="menubar"
      aria-label="Application menu"
      onPointerEnter={warmMenuModel}
      onFocus={warmMenuModel}
    >
      {MENUS.map((label) => {
        const expanded = open?.label === label;
        return (
          <button
            key={label}
            ref={(node) => {
              buttonRefs.current[label] = node;
            }}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={expanded}
            className={`qzk-menu${expanded ? " open" : ""}`}
            tabIndex={focusedMenu === label ? 0 : -1}
            onFocus={() => setFocusedMenu(label)}
            onClick={() => (expanded ? setOpen(null) : openMenu(label))}
            onMouseEnter={() => open && openMenu(label)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                moveTopLevel(
                  label,
                  event.key === "ArrowRight" ? 1 : -1,
                  open !== null,
                );
              } else if (
                event.key === "ArrowDown" ||
                event.key === "Enter" ||
                event.key === " "
              ) {
                event.preventDefault();
                openMenu(label);
              } else if (event.key === "Home" || event.key === "End") {
                event.preventDefault();
                const target =
                  event.key === "Home" ? MENUS[0] : MENUS[MENUS.length - 1];
                setFocusedMenu(target);
                buttonRefs.current[target]?.focus();
                if (open) openMenu(target);
              }
            }}
          >
            {label}
          </button>
        );
      })}

      {open && openItems.length > 0 && (
        <ContextMenu
          key={open.label}
          x={open.x}
          y={open.y}
          items={openItems}
          onClose={() => setOpen(null)}
          onNavigateRoot={(direction) =>
            moveTopLevel(open.label, direction, true)
          }
          returnFocus={buttonRefs.current[open.label]}
        />
      )}

      <span className="qzk-spacer" />
      <button
        type="button"
        className="qzk-search"
        onClick={onOpenPalette}
        data-tip={PALETTE_LABEL}
        data-tip-key={format(PALETTE_SHORTCUT)}
      >
        <span aria-hidden="true">⌕</span>
        <span>Search…</span>
        <span className="qz-shortcut">{format(PALETTE_SHORTCUT)}</span>
      </button>
    </nav>
  );
}
