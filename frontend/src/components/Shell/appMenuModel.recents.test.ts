import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadMenuRecents, MENU_RECENTS_KEY } from "../../lib/menuRecents";
import type { Action } from "../../store/commands";
import { INTERACTION_PREF_DEFAULTS, interactionPrefsSlot } from "../../store/prefs";
import { buildAppMenuItems } from "./appMenuModel";

const fmt = (s: string) => s;
const actions: Action[] = ["a", "b", "c", "d"].map((id) => ({ id, group: "Data", label: `Cmd ${id}`, run: vi.fn() }));
const labels = (items: ReturnType<typeof buildAppMenuItems>) => items.map((i) => ("label" in i ? i.label : "header" in i ? `#${i.header}` : "-"));

beforeEach(() => {
  localStorage.removeItem(MENU_RECENTS_KEY);
  interactionPrefsSlot.save({ ...INTERACTION_PREF_DEFAULTS });
});

describe("recent commands at the bottom of a menu", () => {
  it("is off by default: nothing is added, though use is still recorded", () => {
    const items = buildAppMenuItems("Data", actions, fmt);
    (items.find((i) => "label" in i && i.label === "Cmd a") as { run: () => void }).run();
    expect(labels(buildAppMenuItems("Data", actions, fmt))).not.toContain("#Recent commands");
    expect(loadMenuRecents().Data).toEqual(["a"]);
  });
  it("lists the last commands used from this menu, newest first, capped at three, when switched on", () => {
    interactionPrefsSlot.save({ ...INTERACTION_PREF_DEFAULTS, menuRecents: true });
    for (const id of ["a", "b", "c", "d"]) {
      (buildAppMenuItems("Data", actions, fmt).find((i) => "label" in i && i.label === `Cmd ${id}`) as { run: () => void }).run();
    }
    const l = labels(buildAppMenuItems("Data", actions, fmt));
    expect(l.slice(-4)).toEqual(["#Recent commands", "Cmd d", "Cmd c", "Cmd b"]);
    expect(l[l.length - 5]).toBe("-");
    // another menu has no recents of its own
    expect(labels(buildAppMenuItems("Plot", actions, fmt))).not.toContain("#Recent commands");
  });
  it("never lists a command the menu no longer offers", () => {
    interactionPrefsSlot.save({ ...INTERACTION_PREF_DEFAULTS, menuRecents: true });
    (buildAppMenuItems("Data", actions, fmt).find((i) => "label" in i && i.label === "Cmd a") as { run: () => void }).run();
    expect(labels(buildAppMenuItems("Data", actions.filter((a) => a.id !== "a"), fmt))).not.toContain("#Recent commands");
  });
});
