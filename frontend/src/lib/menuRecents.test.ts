import { beforeEach, describe, expect, it } from "vitest";

import { loadMenuRecents, MENU_RECENTS_CAP, MENU_RECENTS_KEY, recordMenuUse } from "./menuRecents";

beforeEach(() => localStorage.removeItem(MENU_RECENTS_KEY));

describe("menu recents", () => {
  it("orders newest first and moves a repeat to the front without duplicating it", () => {
    recordMenuUse("Plot", "a");
    recordMenuUse("Plot", "b");
    recordMenuUse("Plot", "a");
    expect(loadMenuRecents().Plot).toEqual(["a", "b"]);
  });
  it("caps each menu's list and keeps menus separate", () => {
    for (const id of ["a", "b", "c", "d", "e"]) recordMenuUse("Data", id);
    recordMenuUse("Plot", "z");
    expect(loadMenuRecents().Data).toEqual(["e", "d", "c"]);
    expect(loadMenuRecents().Data).toHaveLength(MENU_RECENTS_CAP);
    expect(loadMenuRecents().Plot).toEqual(["z"]);
  });
  it("persists ids only, across loads", () => {
    recordMenuUse("File", "import");
    expect(JSON.parse(localStorage.getItem(MENU_RECENTS_KEY)!)).toEqual({ File: ["import"] });
  });
  it("survives corrupt storage", () => {
    localStorage.setItem(MENU_RECENTS_KEY, "{not json");
    expect(loadMenuRecents()).toEqual({});
    localStorage.setItem(MENU_RECENTS_KEY, JSON.stringify({ Plot: ["ok", 3, "", "ok", { x: 1 }], Edit: "nope" }));
    expect(loadMenuRecents()).toEqual({ Plot: ["ok"] });
    recordMenuUse("Plot", "b");
    expect(loadMenuRecents().Plot).toEqual(["b", "ok"]);
  });
});
