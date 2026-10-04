import type { ContextMenuItem } from "../overlays/ContextMenu";
import { runAction, type Action } from "../../store/commands";

type Dynamic<T> = T | (() => T);

const COMMON_IDS: Record<string, ReadonlySet<string>> = {
  File: new Set(["import", "open-workspace", "save-workspace", "figure-save"]),
  Edit: new Set(["undo", "redo", "paste-data", "palette"]),
  Data: new Set(["merge", "duplicate", "reimport"]),
  Plot: new Set(["autoscale", "legend", "grid", "plot-in-new-window"]),
  Analyze: new Set(["curvefit", "peak-wizard"]),
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
 * Frequent actions stay at the root; topic groups become one-level flyouts. */
export function buildAppMenuItems(
  group: string,
  actions: readonly Action[],
  formatShortcut: (shortcut: string) => string,
): ContextMenuItem[] {
  const common = COMMON_IDS[group] ?? new Set<string>();
  const roots: ContextMenuItem[] = [];
  const sections = new Map<string, ContextMenuItem[]>();
  const destructive: ContextMenuItem[] = [];

  for (const action of actions) {
    const item = leaf(
      action,
      action.shortcut ? formatShortcut(action.shortcut) : undefined,
    );
    if (action.danger) {
      destructive.push(item);
      continue;
    }
    const section = defaultSection(action);
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
  return result;
}
