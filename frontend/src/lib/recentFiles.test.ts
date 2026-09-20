import { beforeEach, describe, expect, it } from "vitest";

import {
  addRecentEntry,
  clearRecentMeta,
  loadRecent,
  relativeTime,
  removeRecentEntry,
  saveRecent,
  type RecentFile,
} from "./recentFiles";

const mk = (name: string, at = "2026-06-28T00:00:00Z"): RecentFile => ({ name, size: 1, at });

describe("addRecentEntry", () => {
  it("prepends newest and keeps order", () => {
    const list = addRecentEntry(addRecentEntry([], mk("a")), mk("b"));
    expect(list.map((r) => r.name)).toEqual(["b", "a"]);
  });

  it("de-dupes browser uploads by name, bubbling a re-import to the top", () => {
    const start = [mk("a"), mk("b"), mk("c")];
    const list = addRecentEntry(start, mk("b"));
    expect(list.map((r) => r.name)).toEqual(["b", "a", "c"]);
  });

  it("keeps same-named desktop files from different folders", () => {
    const a = { ...mk("scan.csv"), path: "C:\\run-a\\scan.csv" };
    const b = { ...mk("scan.csv"), path: "C:\\run-b\\scan.csv" };
    const list = addRecentEntry(addRecentEntry([], a), b);
    expect(list.map((r) => r.path)).toEqual([b.path, a.path]);
  });

  it("re-importing the same native path replaces only that entry", () => {
    const a = { ...mk("scan.csv"), path: "C:\\run-a\\scan.csv" };
    const b = { ...mk("scan.csv"), path: "C:\\run-b\\scan.csv" };
    const newerA = { ...a, at: "2026-07-01T00:00:00Z" };
    const list = addRecentEntry([b, a], newerA);
    expect(list).toEqual([newerA, b]);
  });

  it("removes one same-named native file by identity", () => {
    const a = { ...mk("scan.csv"), path: "C:\\run-a\\scan.csv" };
    const b = { ...mk("scan.csv"), path: "C:\\run-b\\scan.csv" };
    expect(removeRecentEntry([a, b], a)).toEqual([b]);
  });

  it("caps the list at `max`", () => {
    let list: RecentFile[] = [];
    for (let i = 0; i < 20; i++) list = addRecentEntry(list, mk(`f${i}`), 5);
    expect(list).toHaveLength(5);
    expect(list[0].name).toBe("f19"); // newest first
  });
});

describe("load/save round-trip", () => {
  beforeEach(() => clearRecentMeta());

  it("persists and restores", () => {
    saveRecent([mk("x"), mk("y")]);
    expect(loadRecent().map((r) => r.name)).toEqual(["x", "y"]);
  });

  it("returns [] on an empty / cleared slot", () => {
    expect(loadRecent()).toEqual([]);
  });

  it("ignores a malformed slot", () => {
    localStorage.setItem("qz.recent", "{not json");
    expect(loadRecent()).toEqual([]);
  });
});

describe("relativeTime", () => {
  const base = Date.parse("2026-06-28T12:00:00Z");
  it("buckets seconds → just now", () => {
    expect(relativeTime("2026-06-28T11:59:40Z", base)).toBe("just now");
  });
  it("buckets minutes", () => {
    expect(relativeTime("2026-06-28T11:30:00Z", base)).toBe("30m ago");
  });
  it("buckets hours", () => {
    expect(relativeTime("2026-06-28T09:00:00Z", base)).toBe("3h ago");
  });
  it("special-cases yesterday", () => {
    expect(relativeTime("2026-06-27T12:00:00Z", base)).toBe("yesterday");
  });
  it("buckets days", () => {
    expect(relativeTime("2026-06-24T12:00:00Z", base)).toBe("4d ago");
  });
  it("returns '' for an unparseable time", () => {
    expect(relativeTime("not-a-date", base)).toBe("");
  });
});
