// Menu bar: top-level menus (display-only for now) + a search chip that opens
// the command palette. Publishes a few real commands into the command registry
// so they're searchable in ⌘K (the menu-tree dropdowns land in a later tier).

import { useEffect } from "react";

import { useCommands, type Action } from "../../store/commands";
import { useApp } from "../../store/useApp";

const MENUS = ["File", "Edit", "View", "Analyze", "Tools", "Help"];

export default function MenuBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const setMenuCommands = useCommands((s) => s.setMenuCommands);

  // Republish on every render so command closures read a fresh store snapshot.
  useEffect(() => {
    const s = useApp.getState;
    const cmds: Action[] = [
      {
        id: "menu-density",
        group: "View",
        label: "Cycle density",
        run: () => {
          const order = ["compact", "regular", "comfy"] as const;
          const next = order[(order.indexOf(s().density) + 1) % order.length];
          s().setDensity(next);
        },
      },
      {
        id: "menu-accent",
        group: "View",
        label: "Cycle accent color",
        run: () => {
          const order = ["violet", "teal", "ocean", "amber", "rose"] as const;
          const next = order[(order.indexOf(s().accent) + 1) % order.length];
          s().setAccent(next);
        },
      },
    ];
    setMenuCommands(cmds);
  });

  return (
    <nav className="qzk-menubar">
      {MENUS.map((m) => (
        <span key={m} className="qzk-menu">
          {m}
        </span>
      ))}
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
