import { beforeEach, describe, expect, it } from "vitest";

import {
  addRecentProjectEntry,
  clearRecentProjectsMeta,
  loadRecentProjects,
  saveRecentProjects,
  type RecentProject,
} from "./recentProjects";

const mk = (path: string, at = "2026-06-28T00:00:00Z"): RecentProject => ({
  name: path.split("/").pop() ?? path,
  path,
  at,
});

describe("addRecentProjectEntry", () => {
  it("prepends newest and keeps order", () => {
    const list = addRecentProjectEntry(addRecentProjectEntry([], mk("/a.dwk")), mk("/b.dwk"));
    expect(list.map((r) => r.path)).toEqual(["/b.dwk", "/a.dwk"]);
  });

  it("de-dupes by PATH (not name), bubbling a re-save to the top", () => {
    const start = [mk("/a.dwk"), mk("/b.dwk"), mk("/c.dwk")];
    const list = addRecentProjectEntry(start, mk("/b.dwk"));
    expect(list.map((r) => r.path)).toEqual(["/b.dwk", "/a.dwk", "/c.dwk"]);
  });

  it("keeps two entries with the SAME filename but different paths distinct", () => {
    const list = addRecentProjectEntry(
      addRecentProjectEntry([], { name: "workspace.dwk", path: "/x/workspace.dwk", at: "t" }),
      { name: "workspace.dwk", path: "/y/workspace.dwk", at: "t" },
    );
    expect(list).toHaveLength(2);
  });

  it("caps the list at `max`", () => {
    let list: RecentProject[] = [];
    for (let i = 0; i < 20; i++) list = addRecentProjectEntry(list, mk(`/f${i}.dwk`), 5);
    expect(list).toHaveLength(5);
    expect(list[0].path).toBe("/f19.dwk"); // newest first
  });
});

describe("load/save round-trip", () => {
  beforeEach(() => clearRecentProjectsMeta());

  it("persists and restores", () => {
    saveRecentProjects([mk("/x.dwk"), mk("/y.dwk")]);
    expect(loadRecentProjects().map((r) => r.path)).toEqual(["/x.dwk", "/y.dwk"]);
  });

  it("returns [] on an empty / cleared slot", () => {
    expect(loadRecentProjects()).toEqual([]);
  });

  it("ignores a malformed slot", () => {
    localStorage.setItem("qz.recentProjects", "{not json");
    expect(loadRecentProjects()).toEqual([]);
  });

  it("ignores an entry missing a path (never something addRecentProjectEntry itself would produce, but storage can be hand-edited/corrupted)", () => {
    localStorage.setItem("qz.recentProjects", JSON.stringify([{ name: "x.dwk", at: "t" }]));
    expect(loadRecentProjects()).toEqual([]);
  });

  it("uses a storage key distinct from recentFiles' (qz.recent)", () => {
    saveRecentProjects([mk("/x.dwk")]);
    expect(localStorage.getItem("qz.recent")).toBeNull();
    expect(localStorage.getItem("qz.recentProjects")).not.toBeNull();
  });
});
