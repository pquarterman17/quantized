// UX audit 10 lane B: the menu model's structure, labels, enablement and
// shortcut hints, asserted over the REAL registry (curated list plus the
// hook-published Window / History / Relink / Project-lock commands).

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildAppActions } from "../../appCommands";
import { LEGACY_LABELS } from "../../commands/legacyLabels";
import { AVAILABILITY_RULE_IDS } from "../../commands/menuAvailability";
import { useProjectLockCommands } from "../../commands/projectLockCommands";
import { useRelinkCommands } from "../../commands/relinkCommands";
import { rankActions } from "../../lib/paletteRank";
import { SHORTCUT_GROUPS, formatShortcut } from "../../lib/shortcuts";
import { useCommands, mergeCommands, type Action } from "../../store/commands";
import { useApp } from "../../store/useApp";
import { useHistoryCommands } from "../history/useHistoryCommands";
import { useWindowCommands } from "../windows/useWindowCommands";
import type { ContextMenuItem } from "../overlays/ContextMenu";
import { buildAppMenuItems } from "./appMenuModel";
import { menuHome } from "./appMenuPlacement";

const MENUS = ["File", "Edit", "Data", "Plot", "Insert", "Analyze", "Tools", "View", "Window", "Help"] as const;
const fmt = (s: string) => formatShortcut(s, false);

function registry(): Action[] {
  renderHook(() => {
    useWindowCommands();
    useHistoryCommands();
    useRelinkCommands();
    useProjectLockCommands();
  });
  return mergeCommands(buildAppActions(useApp.getState), useCommands.getState().menuCommands);
}

type Row = { label: string; shortcutLabel?: string; disabled?: boolean; title?: string; checked?: boolean; submenu?: ContextMenuItem[] };
const rows = (items: ContextMenuItem[]): Row[] => items.filter((i): i is ContextMenuItem & Row => "label" in i);
function walk(items: ContextMenuItem[], out: Row[] = []): Row[] {
  for (const r of rows(items)) {
    out.push(r);
    if (r.submenu) walk(r.submenu, out);
  }
  return out;
}
const menu = (group: string, all: Action[]) => buildAppMenuItems(group, all, fmt);
const find = (group: string, all: Action[], label: string) => walk(menu(group, all)).find((r) => r.label === label);

// Proper nouns, product names and acronyms that keep their capitals mid-label.
const EXCEPTIONS = new Set([
  "Origin", "Excel", "SQLite", "DiraCulator", "Analysis", "Center", "Curie–Weiss", "Williamson-Hall", "Pawley", "Tauc",
  "Quantized", "Z-score", "Dunnett", "Fit", "Y", "X", "Z", "Builder", "Group",
]);
function badWords(label: string): string[] {
  const words = label.replace(/[()…·→/,:;“”"—]/g, " ").split(/\s+/).filter(Boolean).slice(1);
  return words.filter((w) => /^[A-Z]/.test(w) && w !== w.toUpperCase() && !EXCEPTIONS.has(w) && !/\d/.test(w));
}

describe("UX10-B menu model", () => {
  let all: Action[];
  beforeEach(() => {
    useApp.setState({ datasets: [], activeId: null, selectedIds: [] });
    all = registry();
  });
  afterEach(() => useCommands.getState().setMenuCommands("windows", []));

  it("menu labels are sentence case (proper nouns and acronyms excepted)", () => {
    const offenders: string[] = [];
    for (const g of MENUS) for (const r of walk(menu(g, all))) if (badWords(r.label).length) offenders.push(`${g}: ${r.label}`);
    expect(offenders).toEqual([]);
  });

  it("uses American spelling in menu labels", () => {
    const labels = MENUS.flatMap((g) => walk(menu(g, all)).map((r) => r.label));
    expect(labels.filter((l) => /colour/i.test(l))).toEqual([]);
  });

  it("Plot > Layout has 12 items or fewer and no flyout holds a single item", () => {
    const layout = menu("Plot", all).find((i) => "submenu" in i && i.label === "Layout");
    expect(layout && "submenu" in layout ? rows(layout.submenu).length : 0).toBeLessThanOrEqual(12);
    const single: string[] = [];
    for (const g of MENUS) for (const r of rows(menu(g, all))) if (r.submenu && rows(r.submenu).length === 1) single.push(`${g} > ${r.label}`);
    expect(single).toEqual([]);
  });

  it("File: Preferences is a top-level item with its shortcut, Save and Save as are separate", () => {
    expect(rows(menu("File", all)).find((r) => r.label === "Preferences…")?.shortcutLabel).toBe("Ctrl+,");
    expect(find("File", all, "Save workspace")?.shortcutLabel).toBe("Ctrl+S");
    expect(find("File", all, "Save workspace as…")?.shortcutLabel).toBe("Ctrl+Shift+S");
    const top = rows(menu("File", all)).map((r) => r.label);
    expect(top.indexOf("Open workspace (.dwk)…")).toBeLessThan(top.indexOf("Save workspace"));
  });

  it("Edit lists Undo and Redo first", () => {
    expect(rows(menu("Edit", all)).slice(0, 2).map((r) => r.label)).toEqual(["Undo", "Redo"]);
  });

  it("figure export is listed once (File > Export), not again under Plot", () => {
    const plot = walk(menu("Plot", all)).map((r) => r.label);
    for (const l of ["Export figure…", "Publication preview…", "Page setup…"]) {
      expect(plot).not.toContain(l);
      expect(walk(menu("File", all)).map((r) => r.label)).toContain(l);
    }
  });

  it("Window: Tile and Cascade are in Arrange; open windows are listed with the focused one checked", () => {
    const arrange = menu("Window", all).find((i) => "submenu" in i && i.label === "Arrange");
    expect(arrange && "submenu" in arrange ? rows(arrange.submenu).map((r) => r.label) : []).toEqual(["Tile windows", "Cascade windows"]);
    const open = rows(menu("Window", all)).filter((r) => r.checked !== undefined);
    expect(open.length).toBeGreaterThan(0);
    expect(open.filter((r) => r.checked)).toHaveLength(1);
  });

  it("with nothing loaded, commands with nothing to act on are disabled with a reason", () => {
    const expectOff = (group: string, label: string) => {
      const r = find(group, all, label);
      expect(r, `${group} > ${label}`).toBeDefined();
      expect(r!.disabled, `${group} > ${label} disabled`).toBe(true);
      expect(r!.title, `${group} > ${label} reason`).toBeTruthy();
    };
    expectOff("Data", "Duplicate active dataset");
    expectOff("Data", "Re-import active dataset");
    expectOff("Plot", "Toggle grid lines");
    expectOff("Plot", "Toggle legend");
    expectOff("Window", "Close window");
    expectOff("Window", "Duplicate window");
    expectOff("Window", "New graph window");
    expectOff("Edit", "Undo");
    expectOff("Edit", "Redo");
    expectOff("File", "Save editable figure");
    expectOff("File", "Pack project…");
    expectOff("File", "Take over editing");
    expectOff("File", "Remove all…");
    expectOff("Insert", "Arrow");
    expectOff("Insert", "Table…");
    expectOff("Data", "Merge selected datasets");
    // UX11 N3: these were enabled with nothing to act on (Exchange X-Y left a ghost window).
    expectOff("Plot", "Exchange X–Y axes");
    expectOff("Plot", "Magnifier inset");
    expectOff("Data", "Recalculate now (run stale corrections + fits)");
  });

  it("UX11 N4: File > Export is grouped by separators (data, Origin, figure, publication and page, recipes)", () => {
    const exp = menu("File", all).find((i) => "label" in i && i.label === "Export");
    const sub = (exp as { submenu: ContextMenuItem[] }).submenu;
    const groups: string[][] = [[]];
    for (const i of sub) {
      if ("separator" in i) groups.push([]);
      else if ("label" in i) groups[groups.length - 1]!.push(i.label);
    }
    expect(groups.length).toBe(5);
    expect(groups.every((g) => g.length > 0)).toBe(true);
    expect(groups.flat().length).toBeGreaterThanOrEqual(15);
    expect(groups[0]).toContain("Quick convert…");
    expect(groups[4]!.join("|")).toContain("Save editable figure");
  });

  it("UX11 N6: the palette category follows the menu a command is listed under", () => {
    const home = (id: string) => { const a = all.find((x) => x.id === id)!; return menuHome(a.id, a.group); };
    expect(home("calculators")).toBe("Tools");
    expect(home("trash")).toBe("File");
    expect(home("page-setup")).toBe("File");
    expect(home("export-figure")).toBe("File");
    expect(home("export-pdf")).toBe("File");
    expect(home("autoscale")).toBe("Plot");
  });

  it("UX11 N5: a disabled reason and the browser-reserved note are joined with a full stop", () => {
    const r = find("Window", all, "New graph window");
    expect(r?.title).toBe("Import or select a dataset first. Desktop app only: browsers reserve Ctrl+Shift+N.");
  });

  it("UX11 N7: Theme: Dark / Light are explicit, palette-only commands that set the theme", () => {
    for (const [id, mode] of [["theme-dark", "dark"], ["theme-light", "light"]] as const) {
      const a = all.find((x) => x.id === id)!;
      expect(a.paletteOnly).toBe(true);
      useApp.getState().setTheme(mode === "dark" ? "light" : "dark");
      void a.run();
      expect(useApp.getState().theme).toBe(mode);
      void a.run(); // idempotent: never a flip
      expect(useApp.getState().theme).toBe(mode);
    }
  });

  it("every availability rule names a real command", () => {
    const ids = new Set(all.map((a) => a.id));
    expect(AVAILABILITY_RULE_IDS.filter((id) => !ids.has(id))).toEqual([]);
  });

  it("every shortcut-sheet entry that has a command shows on that command's menu item", () => {
    const hint = (id: string): string => {
      const a = all.find((x) => x.id === id)!;
      const g = a.group;
      const label = a.labelFn ? a.labelFn() : a.label;
      for (const m of [g, "File", "Edit", "Tools"]) {
        const r = walk(menu(m, all)).find((x) => x.label === label);
        if (r?.shortcutLabel) return r.shortcutLabel;
      }
      return "";
    };
    const sheet = new Map<string, string>(); // chord (windows form) -> command id
    const pairs: [string, string][] = [
      ["⌘ O", "import"], ["⌘ S", "save-workspace-quick"], ["⌘ ⇧ S", "save-workspace"], ["⌘ N", "new-workbook"],
      ["⌘ J", "copy-figure"], ["F2", "rename-dataset"], ["⌘ ⇧ L", "theme"], ["⌘ Z", "history-undo"], ["⌘ ⇧ Z", "history-redo"], ["⌘ ,", "preferences"], ["⌘ [", "left"], ["⌘ B", "left"],
      ["⌘ ]", "right"], ["⌘ R", "autoscale"], ["A", "autoscale"], ["⌥ ←", "view-back"], ["⌥ →", "view-forward"],
      ["F", "curvefit"], ["Y", "hysteresis"], ["P", "peaks"], ["⌘ ⇧ N", "window-new"], ["⌘ ⇧ D", "window-duplicate"],
      ["⌘ ⇧ W", "window-close"], ["⌃ Tab", "window-focus-next"], ["⌃ ⇧ Tab", "window-focus-prev"],
    ];
    for (const [k, id] of pairs) sheet.set(k, id);
    const sheetKeys = new Set(SHORTCUT_GROUPS.flatMap((g) => g.items.map((i) => i.keys)));
    const missing: string[] = [];
    for (const [k, id] of sheet) {
      if (!sheetKeys.has(k)) missing.push(`sheet lacks ${k}`);
      const want = fmt(k.replace(/\s+/g, ""));
      if (!hint(id).includes(want)) missing.push(`${id} hint "${hint(id)}" lacks ${want}`);
    }
    expect(missing).toEqual([]);
  });

  it("browser-reserved window chords carry a desktop-only note", () => {
    const close = find("Window", all, "Close window");
    expect(close?.shortcutLabel).toContain("desktop app");
    expect(close?.title).toContain("Desktop app only");
  });

  it("every relabelled command is still found in the palette under its old name", () => {
    const misses: string[] = [];
    for (const [id, old] of Object.entries(LEGACY_LABELS)) {
      const query = old.split(" ").slice(0, 3).join(" ");
      const ids = rankActions(all, query).slice(0, 5).map((r) => r.a.id);
      if (!ids.includes(id)) misses.push(`${query} -> ${id} (got ${ids.join(",")})`);
    }
    expect(misses).toEqual([]);
  });

  it("hook-published renames keep their old label as a palette synonym", () => {
    for (const [old, id] of [["Pin Window", "window-pin"], ["Focus Next Window", "window-focus-next"], ["Take Over Editing", "take-over-editing"], ["Open as Copy", "open-as-copy"], ["Save Editable Figure", "figure-save"], ["Duplicate Window", "window-duplicate"]] as const) {
      expect(rankActions(all, old).slice(0, 3).map((r) => r.a.id), old).toContain(id);
    }
  });
});
