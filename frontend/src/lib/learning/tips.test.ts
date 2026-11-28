// Every tip names a command and an exact menu path; both are resolved against
// the REAL command registry (buildAppActions) and the REAL menu model
// (buildAppMenuItems, the code the menu bar runs), so a moved or renamed
// command fails here instead of leaving a stale tip.

import { describe, expect, it } from "vitest";

import { buildAppActions } from "../../appCommands";
import { buildAppMenuItems } from "../../components/Shell/appMenuModel";
import type { ContextMenuItem } from "../../components/overlays/ContextMenu";
import { useApp } from "../../store/useApp";
import { TIP_PATH_SEP, TIPS, tipAt } from "./tips";

const MENUS = ["File", "Edit", "Data", "Plot", "Insert", "Analyze", "Tools", "View", "Window", "Help"];

function walk(items: ContextMenuItem[], prefix: string[], out: Map<string, string>): void {
  for (const item of items) {
    if (!("label" in item)) continue;
    const path = [...prefix, item.label];
    if ("submenu" in item && item.submenu) walk(item.submenu, path, out);
    else out.set(path.join(TIP_PATH_SEP), item.label);
  }
}

const actions = buildAppActions(useApp.getState);
const paths = new Map<string, string>();
for (const menu of MENUS) walk(buildAppMenuItems(menu, actions, (s) => s), [menu], paths);

describe("tip of the day content", () => {
  it("has about twenty tips with unique ids", () => {
    expect(TIPS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(TIPS.map((t) => t.id)).size).toBe(TIPS.length);
  });

  it.each(TIPS.map((t) => [t.id, t] as const))("%s: its command is registered", (_id, tip) => {
    const action = actions.find((a) => a.id === tip.command);
    expect(action, `command "${tip.command}" is not in the registry`).toBeDefined();
    // The path ends in the command's own label.
    expect(tip.path.endsWith(`${TIP_PATH_SEP}${action!.label}`)).toBe(true);
  });

  it.each(TIPS.map((t) => [t.id, t] as const))("%s: its menu path exists in the real menu", (_id, tip) => {
    expect(paths.has(tip.path), `"${tip.path}" is not a menu path`).toBe(true);
  });

  it("tipAt wraps in both directions and survives a junk index", () => {
    expect(tipAt(0)).toBe(TIPS[0]);
    expect(tipAt(TIPS.length)).toBe(TIPS[0]);
    expect(tipAt(-1)).toBe(TIPS[TIPS.length - 1]);
    expect(tipAt(Number.NaN)).toBe(TIPS[0]);
  });
});
