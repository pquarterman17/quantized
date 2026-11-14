import type { ContextMenuItem } from "../overlays/ContextMenu";
import { reopenRecent } from "../../lib/reopenRecent";
import { recentParentLabel, relativeTime, type RecentFile } from "../../lib/recentFiles";
import { runAction, type Action } from "../../store/commands";
import { useApp } from "../../store/useApp";

// File's Recent / Manage recent flyouts, moved verbatim out of MenuBar.tsx
// into this lazily-loaded model (bundle diet, figures audit 2026-11-13): the
// menu is only ever built once a menu opens, so neither the flyouts nor
// lib/reopenRecent behind them need to ship in the eager bundle.

function recentLabel(entry: RecentFile, now: number): string {
  const parent = entry.path ? ` — ${recentParentLabel(entry.path)}` : "";
  return `${entry.name}${parent} · ${relativeTime(entry.at, now)}`;
}

const reopen = (entry: RecentFile) => {
  if (!entry.path)
    useApp.getState().setStatus(`re-select "${entry.name}" to import it`);
  void reopenRecent(useApp.getState(), entry);
};

/** The File menu's trailing Recent / Manage recent flyouts (none when the
 *  recent list is empty). */
export function recentMenuItems(): ContextMenuItem[] {
  const { recent, clearRecent } = useApp.getState();
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
}

type Dynamic<T> = T | (() => T);

const COMMON_IDS: Record<string, ReadonlySet<string>> = {
  File: new Set(["new-workbook", "import", "open-workspace", "save-workspace", "figure-save"]),
  Edit: new Set(["undo", "redo", "paste-data", "palette"]),
  Data: new Set(["merge", "duplicate", "reimport"]),
  Plot: new Set(["autoscale", "legend", "grid", "plot-in-new-window"]),
  Analyze: new Set(["analysis-center", "curvefit", "peak-wizard"]),
  Window: new Set(["window-new", "window-close", "window-tile"]),
  View: new Set(["plot", "worksheet", "left", "right"]),
};

const FILE_SECTIONS: Record<string, string> = {
  "import-append": "Import",
  "import-wizard": "Import",
  "import-origin-template": "Import",
  demo: "Import",
  "load-sample": "Import",
  "open-workspace-safe": "Project",
  "append-workspace": "Project",
  "pack-project": "Project",
  "clear-autosave": "Project",
  "figure-save": "Figures & recipes",
  "figure-save-as": "Figures & recipes",
  "figure-save-recipe": "Figures & recipes",
  "export-csv": "Export",
  "export-hdf5": "Export",
  "export-origin": "Export",
  "export-origin-project": "Export",
  "send-to-origin": "Export",
  "export-consolidated": "Export",
  "export-page": "Export",
  preferences: "Settings",
};

/** Commands that live in another menu but are ALSO listed under a menu's
 *  section, because that is where users look for them (figures audit #18:
 *  Origin users open File > Export for figure export, page setup and the
 *  publication preview, which otherwise sit only under Plot > Build & export
 *  and Plot > Layout). Same command, same id — just a second entry point. */
const CROSS_LISTED: Record<string, Readonly<Record<string, string>>> = {
  File: { "export-figure": "Export", "figure-builder": "Export", "page-setup": "Export" },
};

const WINDOW_SECTIONS: Record<string, string> = {
  "window-duplicate": "Create & open",
  "window-snapshot": "Create & open",
  "window-worksheet": "Create & open",
  "window-map": "Create & open",
  "window-cascade": "Arrange",
  "window-bg-cycle": "Active window",
  "window-link-cycle": "Active window",
  "window-pin": "Active window",
  "window-focus-next": "Navigate",
  "window-focus-prev": "Navigate",
};

const VIEW_SECTIONS: Record<string, string> = {
  theme: "Appearance",
  density: "Appearance",
  accent: "Appearance",
  "toggle-excluded-rows": "Appearance",
  "column-switcher": "Panels & workspace",
  workflow: "Panels & workspace",
  "reset-tool-windows": "Panels & workspace",
};

function value<T>(input: Dynamic<T> | undefined): T | undefined {
  return typeof input === "function" ? (input as () => T)() : input;
}

function defaultSection(action: Action): string | undefined {
  if (action.section) return action.section;
  if (action.group === "File") return FILE_SECTIONS[action.id];
  if (action.group === "Window") return WINDOW_SECTIONS[action.id];
  if (action.group === "View") return VIEW_SECTIONS[action.id];
  return undefined;
}

function leaf(action: Action, shortcut: string | undefined): ContextMenuItem {
  const disabled = value(action.disabled) ?? false;
  const reason = value(action.disabledReason);
  return {
    label: action.label,
    run: () => runAction(action),
    checked: value(action.checked),
    disabled,
    danger: action.danger,
    title: disabled && reason ? reason : action.description,
    shortcutLabel: shortcut,
  };
}

/** Turn a flat command group into a short native-style application menu.
 * Frequent actions stay at the root; topic groups become one-level flyouts.
 * `actions` may be every command: only `group`'s own, plus its
 * `CROSS_LISTED` entries from other menus, are shown. */
export function buildAppMenuItems(
  group: string,
  actions: readonly Action[],
  formatShortcut: (shortcut: string) => string,
): ContextMenuItem[] {
  const common = COMMON_IDS[group] ?? new Set<string>();
  const crossListed = CROSS_LISTED[group] ?? {};
  const roots: ContextMenuItem[] = [];
  const sections = new Map<string, ContextMenuItem[]>();
  const destructive: ContextMenuItem[] = [];

  for (const action of actions) {
    const guest = action.group !== group ? crossListed[action.id] : undefined;
    if (action.group !== group && guest === undefined) continue;
    const item = leaf(
      action,
      action.shortcut ? formatShortcut(action.shortcut) : undefined,
    );
    if (action.danger) {
      destructive.push(item);
      continue;
    }
    const section = guest ?? defaultSection(action);
    if (common.has(action.id) || !section) {
      roots.push(item);
      continue;
    }
    const bucket = sections.get(section);
    if (bucket) bucket.push(item);
    else sections.set(section, [item]);
  }

  const result = [...roots];
  if (roots.length && sections.size) result.push({ separator: true });
  for (const [label, submenu] of sections) result.push({ label, submenu });
  if (destructive.length) {
    if (result.length) result.push({ separator: true });
    result.push(...destructive);
  }
  // File ends with Recent / Manage recent, as it always has.
  return group === "File" ? [...result, ...recentMenuItems()] : result;
}
