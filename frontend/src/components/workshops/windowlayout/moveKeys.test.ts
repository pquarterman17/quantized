// The move-mode key table and the announcement sentences.

import { describe, expect, it } from "vitest";

import { dock, emptyLayout, float } from "../../../lib/windowLayout/ops";
import { describeChange } from "./layoutAnnounce";
import { moveAction } from "./moveKeys";

const key = (k: string, over: Partial<Parameters<typeof moveAction>[0]> = {}) => moveAction({ key: k, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...over });

describe("moveAction", () => {
  it("arrows move by 16 px, Shift+arrows by 1 px", () => {
    expect(key("ArrowLeft")).toEqual({ type: "move", dx: -16, dy: 0 });
    expect(key("ArrowRight")).toEqual({ type: "move", dx: 16, dy: 0 });
    expect(key("ArrowUp")).toEqual({ type: "move", dx: 0, dy: -16 });
    expect(key("ArrowDown")).toEqual({ type: "move", dx: 0, dy: 16 });
    expect(key("ArrowRight", { shiftKey: true })).toEqual({ type: "move", dx: 1, dy: 0 });
    expect(key("ArrowUp", { shiftKey: true })).toEqual({ type: "move", dx: 0, dy: -1 });
  });

  it("L R B C dock, F floats, Enter commits, in either case", () => {
    expect(key("l")).toEqual({ type: "dock", slot: "left" });
    expect(key("R")).toEqual({ type: "dock", slot: "right" });
    expect(key("b")).toEqual({ type: "dock", slot: "bottom" });
    expect(key("C")).toEqual({ type: "dock", slot: "centre" });
    expect(key("f")).toEqual({ type: "float" });
    expect(key("Enter")).toEqual({ type: "commit" });
  });

  it("refuses chords and every other key (Escape cancels through the app's ladder)", () => {
    expect(key("l", { ctrlKey: true })).toBeNull();
    expect(key("c", { metaKey: true })).toBeNull();
    expect(key("f", { altKey: true })).toBeNull();
    expect(key("L", { shiftKey: true })).toBeNull();
    expect(key("Escape")).toBeNull();
    expect(key("x")).toBeNull();
    expect(key("Tab")).toBeNull();
  });
});

describe("describeChange", () => {
  const title = (r: string) => (r === "plot:a" ? "Graph A" : r === "plot:b" ? "Graph B" : r);

  it("one window docking says where and its place in the stack", () => {
    const before = dock(emptyLayout(), "style", "right");
    const after = dock(before, "plot:a", "right");
    expect(describeChange(before, after, title)).toBe("Graph A docked right, 2 of 2");
    expect(describeChange(emptyLayout(), dock(emptyLayout(), "plot:a", "centre"), title)).toBe("Graph A docked centre, 1 of 1");
  });

  it("floating and closing are announced; a z change or no change is silent", () => {
    const docked = dock(dock(emptyLayout(), "plot:a", "left"), "plot:b", "left");
    expect(describeChange(docked, float(docked, "plot:a"), title)).toBe("Graph A floating");
    const floating = float(float(emptyLayout(), "plot:a"), "plot:b");
    expect(describeChange(floating, float(floating, "plot:a"), title)).toBeNull();
    expect(describeChange(floating, floating, title)).toBeNull();
    const closed = { ...floating, placements: { ...floating.placements, "plot:a": { ...floating.placements["plot:a"]!, open: false } }, z: ["plot:b" as const] };
    expect(describeChange(floating, closed, title)).toBe("Graph A closed");
  });

  it("several windows at once are summarised", () => {
    const docked = dock(dock(emptyLayout(), "plot:a", "left"), "plot:b", "right");
    const floated = float(float(docked, "plot:a"), "plot:b");
    expect(describeChange(docked, floated, title)).toBe("2 windows floating");
    const tiled = { ...dock(dock(floated, "plot:a", "centre"), "plot:b", "centre"), centre: "grid" as const };
    expect(describeChange(floated, tiled, title)).toBe("2 windows tiled in the centre");
    expect(describeChange(floated, dock(dock(floated, "plot:a", "left"), "plot:b", "right"), title)).toBe("2 windows docked");
    expect(describeChange(dock(floated, "plot:a", "left"), float(dock(floated, "plot:b", "right"), "plot:a"), title)).toBe("2 windows rearranged");
  });
});
