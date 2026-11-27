import type { ContextMenuItem } from "../overlays/ContextMenu";
import { reopenRecent } from "../../lib/reopenRecent";
import type { RecentFile } from "../../lib/recentFiles";
import { recentParentLabel, relativeTime } from "../../lib/recentLabels";
import { recentAnalysisActions, resultsForDataset } from "../../lib/analysisNavigator";
import { useAnalysisCenter } from "../../store/analysisCenter";
import { jumpBackInHistory, undoHistoryRows } from "../../lib/undoHistory";
import { runAction, type Action } from "../../store/commands";
import { withHookDocs } from "../../commands/hookCommandDocs";
import { useApp } from "../../store/useApp";
import { loadMenuRecents, recordMenuUse } from "../../lib/menuRecents";
import { loadInteractionPrefs } from "../../store/prefs";
import { displayedWindowTitle } from "../../lib/plotWindows";
import { hasDesktopShell } from "../../lib/desktopBridge";
import {
  ALSO_LISTED,
  BREAK_BEFORE,
  BROWSER_RESERVED,
  FLYOUT_ALIAS,
  FLYOUT_GROUPS,
  EXTRA_SHORTCUT,
  LISTED_UNDER_FILE,
  PLACEMENT,
  ROOT_ORDER,
  SECTION_ORDER,
} from "./appMenuPlacement";

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
        // A browser keeps no path to a picked file, so a path-less entry can only reopen
        // the import picker (UX10 P2-5): say so instead of promising a reopen.
        label: entry.path ? recentLabel(entry, now) : `Import again: ${recentLabel(entry, now)}`,
        title: entry.path ?? `Opens the import picker: browsers cannot reopen ${entry.name} by path`,
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

/** Edit's trailing "Undo history" flyout: the last 20 edits, newest first, the
 *  current state marked; a click jumps back to the state after that edit (the
 *  redo stack stays intact). Built per menu open, like Recent. */
export function undoHistoryMenuItems(): ContextMenuItem[] {
  const rows = undoHistoryRows(useApp.getState().history, undefined, useApp.getState().datasets);
  if (!rows.length) {
    return [{ separator: true }, { label: "Undo history", submenu: [], disabled: true, title: "Nothing to undo yet" }];
  }
  return [
    { separator: true },
    {
      label: "Undo history",
      submenu: rows.map((r) => ({
        label: r.label,
        checked: r.current,
        title: r.current ? "Current state" : `Jump back ${r.stepsBack} step${r.stepsBack === 1 ? "" : "s"} (Redo returns)`,
        shortcutLabel: r.current ? "current" : undefined,
        run: () => void jumpBackInHistory(useApp.getState, r.stepsBack, r.seq),
      })),
    },
  ];
}

/** The Analyze menu's navigator rows: "Recent analyses" (the last five tools
 *  run, from the persisted Analysis Center list) and "Open results (N)" for
 *  the active worksheet. Each is omitted when empty; disabled tools stay listed
 *  with their reason (`leaf`). */
function analyzeNavigatorItems(
  actions: readonly Action[],
  formatShortcut: (shortcut: string) => string,
): ContextMenuItem[] {
  const { analysisResults, activeId } = useApp.getState();
  const recent = recentAnalysisActions(actions, useAnalysisCenter.getState().recent);
  const results = resultsForDataset(analysisResults, activeId);
  const rows: ContextMenuItem[] = [];
  if (recent.length) {
    rows.push({ header: "Recent analyses" });
    for (const action of recent) rows.push(leaf(action, action.shortcut ? formatShortcut(action.shortcut) : undefined));
  }
  if (results.length) {
    const open = (id: string) => () => useApp.setState({ openAnalysisResultId: id });
    const title = "Reveal saved results for the active worksheet";
    const label = `Open results (${results.length})`;
    rows.push(
      results.length === 1
        ? { label, title, run: open(results[0]!.id) }
        : { label, title, submenu: results.map((r) => ({ label: `${r.name} · ${r.producer.label}`, run: open(r.id) })) },
    );
  }
  return rows.length ? [...rows, { separator: true }] : [];
}

const MAX_LISTED_WINDOWS = 16;

/** Window > one row per open window, the focused one checked. */
export function windowListItems(): ContextMenuItem[] {
  const { plotWindows, focusedWindowId, datasets, focusWindow, setStageTab } = useApp.getState();
  if (plotWindows.length === 0) return [];
  const rows: ContextMenuItem[] = plotWindows.slice(0, MAX_LISTED_WINDOWS).map((w) => ({
    label: displayedWindowTitle(w, datasets),
    checked: w.id === focusedWindowId,
    title: w.kind === "plot" ? "Bring this window to the front" : `Bring this ${w.kind} window to the front`,
    run: () => {
      setStageTab("plot");
      focusWindow(w.id);
    },
  }));
  return [{ separator: true }, { header: "Open windows" }, ...rows];
}

type Dynamic<T> = T | (() => T);

const COMMON_IDS: Record<string, ReadonlySet<string>> = {
  File: new Set(["new-workbook", "import", "open-workspace", "save-workspace-quick", "save-workspace"]),
  Edit: new Set(["undo", "redo", "paste-data", "palette"]),
  Data: new Set(["merge", "duplicate", "reimport"]),
  Plot: new Set(["autoscale", "legend", "grid", "plot-in-new-window"]),
  Analyze: new Set(["analysis-center", "curvefit", "peak-wizard"]),
  Window: new Set(["window-new", "window-close"]),
  View: new Set(["plot", "worksheet", "left", "right"]),
};

/** Frequent commands kept at a menu's root that ALSO appear in their own topic
 *  flyout, where users browsing that topic look for them (UX audit 8 #6:
 *  Analyze > Fit did not list Curve fit, Peaks & baseline not Peak analyzer).
 *  Same command, same id: a second entry point, not a second command. */
const ALSO_IN_SECTION: Record<string, ReadonlySet<string>> = {
  Analyze: new Set(["curvefit", "peak-wizard"]),
};

const FILE_SECTIONS: Record<string, string> = {
  "import-sheets": "Import",
  "import-append": "Import",
  "import-wizard": "Import",
  "import-origin-template": "Import",
  demo: "Import",
  "load-sample": "Import",
  "open-workspace-safe": "Project",
  "append-workspace": "Project",
  "pack-project": "Project",
  "clear-autosave": "Project",
  "figure-save": "Export",
  "figure-save-as": "Export",
  "figure-save-recipe": "Export",
  "export-worksheet": "Export",
  "quick-convert": "Export",
  "export-csv": "Export",
  "export-hdf5": "Export",
  "export-origin": "Export",
  "export-origin-project": "Export",
  "send-to-origin": "Export",
  "export-consolidated": "Export",
  "export-page": "Export",
};

/** Commands that live in another menu but are ALSO listed under a menu's
 *  section, because that is where users look for them (figures audit #18:
 *  Origin users open File > Export for figure export, page setup and the
 *  publication preview, which otherwise sit only under Plot > Export (now File > Export)
 *  and Plot > Layout). Same command, same id — just a second entry point. */
const CROSS_LISTED: Record<string, Readonly<Record<string, string>>> = {
  File: { "export-figure": "Export", "export-figure-quick": "Export", "figure-builder": "Export", "page-setup": "Export" },
  // The polar map is a Plot chart; map users also look under Analyze > Maps (UX menus audit M2 / N5).
  Analyze: { "plot-polar-map": "Maps" },
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

/** A flyout split into `groups` with separators (File > Export, Plot > Axes ...). */
function groupFlyout(
  items: ContextMenuItem[],
  idOf: ReadonlyMap<ContextMenuItem, string>,
  groups: readonly (readonly string[])[],
): ContextMenuItem[] {
  const listed = new Set(groups.flat());
  const rows = groups.map((ids) => ids.flatMap((id) => items.filter((it) => idOf.get(it) === id)));
  rows.push(items.filter((it) => !listed.has(idOf.get(it) ?? "")));
  const out: ContextMenuItem[] = [];
  for (const g of rows) {
    if (!g.length) continue;
    if (out.length) out.push({ separator: true });
    out.push(...g);
  }
  return out;
}

/** `title` followed by `note` as one more sentence. */
function withNote(title: string | undefined, note: string): string {
  return `${title ? title.replace(/[.!?]?$/, ". ") : ""}${note}`;
}

type LeafItem = Extract<ContextMenuItem, { run: () => void }>;

function leaf(action: Action, shortcut: string | undefined, menu?: string): LeafItem {
  const disabled = value(action.disabled) ?? false;
  const reason = value(action.disabledReason);
  return {
    label: action.labelFn ? action.labelFn() : action.label,
    run: () => {
      if (menu && !action.danger && !action.perEntity) recordMenuUse(menu, action.id); // the menu's recent commands
      runAction(action);
    },
    checked: value(action.checked),
    disabled,
    danger: action.danger,
    title: disabled && reason ? reason : action.description,
    shortcutLabel: shortcut,
  };
}

/** Preferences > Interaction > "Recent commands in menus": the last few commands run from
 *  this menu, newest first, at its bottom. Only what the menu itself lists, so a command
 *  that left the menu (or is palette-only) never reappears here. */
function recentCommandItems(
  group: string,
  listed: ReadonlyMap<string, Action>,
  formatShortcut: (shortcut: string) => string,
): ContextMenuItem[] {
  if (group === "Help" || loadInteractionPrefs().menuRecents !== true) return []; // Help appends its own tail (MenuBar)
  const rows = (loadMenuRecents()[group] ?? []).flatMap((id) => {
    const action = listed.get(id);
    return action ? [leaf(action, action.shortcut ? formatShortcut(action.shortcut) : undefined, group)] : [];
  });
  return rows.length ? [{ separator: true }, { header: "Recent commands" }, ...rows] : [];
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
  const roots: { id: string; item: LeafItem }[] = [];
  const sections = new Map<string, ContextMenuItem[]>();
  const destructive: ContextMenuItem[] = [];
  const idOf = new Map<ContextMenuItem, string>();
  const browser = !hasDesktopShell();
  const listed = new Map<string, Action>(); // what this menu lists (its recent commands draw from it)

  for (const action of withHookDocs(actions)) {
    if (action.paletteOnly) continue;
    const place = PLACEMENT[action.id];
    const home = place?.menu ?? action.group;
    const guest = home !== group ? crossListed[action.id] : undefined;
    if (home !== group && guest === undefined) continue;
    if (home === group && group !== "File" && LISTED_UNDER_FILE.has(action.id)) continue;
    const item = leaf(action, action.shortcut ? formatShortcut(action.shortcut) : undefined, group);
    idOf.set(item, action.id);
    if (!action.danger && !action.perEntity) listed.set(action.id, action);
    const extra = EXTRA_SHORTCUT[action.id];
    if (extra && item.shortcutLabel) item.shortcutLabel = `${item.shortcutLabel}, ${formatShortcut(extra)}`;
    if (browser && BROWSER_RESERVED.has(action.id) && item.shortcutLabel) {
      const reserved = item.shortcutLabel;
      item.shortcutLabel = `${reserved} (desktop app)`;
      item.title = withNote(item.title, `Desktop app only: browsers reserve ${reserved}.`);
    }
    // A bare-letter shortcut (F, Y, P, A, ?) is ignored while a text field has focus (UX menus audit N18).
    if (!item.disabled && action.shortcut && /^[A-Za-z?]$/.test(action.shortcut)) {
      item.title = withNote(item.title, "The bare-key shortcut works when no text field has focus.");
    }
    if (action.danger) {
      destructive.push(item);
      continue;
    }
    const sectionName = guest ?? (place && "section" in place ? (place.section ?? undefined) : defaultSection(action));
    const section = sectionName === undefined ? undefined : (FLYOUT_ALIAS[`${group}/${sectionName}`] ?? sectionName);
    const addTo = (name: string, it: ContextMenuItem) => {
      idOf.set(it, action.id);
      const bucket = sections.get(name);
      if (bucket) bucket.push(it);
      else sections.set(name, [it]);
    };
    const also = ALSO_LISTED[group]?.[action.id];
    if (also) addTo(also, { ...item });
    if (common.has(action.id) || !section) {
      roots.push({ id: action.id, item });
      if (!section || !ALSO_IN_SECTION[group]?.has(action.id)) continue;
    }
    addTo(section, common.has(action.id) ? { ...item } : item);
  }

  const order = ROOT_ORDER[group] ?? [];
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  const ordered = roots.map((r, i) => ({ ...r, i })).sort((a, b) => rank(a.id) - rank(b.id) || a.i - b.i);
  const breaks = BREAK_BEFORE[group];
  const rootItems: ContextMenuItem[] = [];
  for (const r of ordered) {
    if (breaks?.has(r.id) && rootItems.length) rootItems.push({ separator: true });
    rootItems.push(r.item);
  }
  const sectionOrder = SECTION_ORDER[group] ?? [];
  const sectionRank = (label: string) => (sectionOrder.includes(label) ? sectionOrder.indexOf(label) : sectionOrder.length);
  const sectionRows = [...sections].map(([label, submenu], i) => ({ label, submenu, i })).sort((a, b) => sectionRank(a.label) - sectionRank(b.label) || a.i - b.i);

  const result = [...rootItems];
  if (group === "Analyze") result.unshift(...analyzeNavigatorItems(actions, formatShortcut));
  if (rootItems.length && sectionRows.length) result.push({ separator: true });
  for (const { label, submenu } of sectionRows) {
    const groups = FLYOUT_GROUPS[`${group}/${label}`];
    result.push({ label, submenu: groups ? groupFlyout(submenu, idOf, groups) : submenu });
  }
  if (group === "Edit") result.push(...undoHistoryMenuItems());
  if (group === "Window") result.push(...windowListItems());
  if (destructive.length) {
    if (result.length) result.push({ separator: true });
    result.push(...destructive);
  }
  // File ends with Recent / Manage recent, as it always has.
  const full = group === "File" ? [...result, ...recentMenuItems()] : result;
  return [...full, ...recentCommandItems(group, listed, formatShortcut)];
}
