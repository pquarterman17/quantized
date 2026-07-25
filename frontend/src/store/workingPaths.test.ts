import { beforeEach, describe, expect, it } from "vitest";

import {
  defaultLabel,
  evictPaths,
  MAX_UNPINNED,
  orderPaths,
  touchPath,
  useWorkingPaths,
  WORKING_PATHS_KEY,
  type WorkingPath,
} from "./workingPaths";

const wp = (path: string, usedAt: number, pinned = false): WorkingPath => ({
  path,
  label: defaultLabel(path),
  pinned,
  usedAt,
});

describe("defaultLabel", () => {
  it("uses the last segment, on either separator", () => {
    const B = String.fromCharCode(92);
    expect(defaultLabel("/data/runs/xrd")).toBe("xrd");
    expect(defaultLabel(`C:${B}data${B}xrd`)).toBe("xrd");
    expect(defaultLabel(`${B}${B}server${B}share`)).toBe("share");
  });

  it("tolerates a trailing separator", () => {
    expect(defaultLabel("/data/runs/")).toBe("runs");
  });
});

describe("orderPaths", () => {
  it("puts pinned first, then most-recently-used", () => {
    const out = orderPaths([wp("/a", 3), wp("/b", 1, true), wp("/c", 2)]);
    expect(out.map((p) => p.path)).toEqual(["/b", "/a", "/c"]);
  });
});

describe("evictPaths", () => {
  it("caps unpinned entries", () => {
    const many = Array.from({ length: MAX_UNPINNED + 4 }, (_, i) => wp(`/p${i}`, i));
    expect(evictPaths(many)).toHaveLength(MAX_UNPINNED);
  });

  it("NEVER evicts a pinned entry, however old", () => {
    // Pinning is the user saying "keep this" — recency must not override it.
    const many = Array.from({ length: MAX_UNPINNED + 4 }, (_, i) => wp(`/p${i}`, i + 10));
    const out = evictPaths([wp("/ancient", 0, true), ...many]);
    expect(out.some((p) => p.path === "/ancient")).toBe(true);
    expect(out.filter((p) => !p.pinned)).toHaveLength(MAX_UNPINNED);
  });
});

describe("touchPath", () => {
  it("adds a new path as most recent", () => {
    expect(touchPath([wp("/old", 1)], "/new", 5)[0].path).toBe("/new");
  });

  it("re-uses an existing entry rather than duplicating it", () => {
    const out = touchPath([wp("/a", 1), wp("/b", 2)], "/a", 9);
    expect(out.filter((p) => p.path === "/a")).toHaveLength(1);
    expect(out[0].path).toBe("/a");
  });

  it("KEEPS a rename and a pin when the folder is revisited", () => {
    // Re-visiting must not silently discard the user's own labelling.
    const custom: WorkingPath = { path: "/a", label: "Beamline 4", pinned: true, usedAt: 1 };
    const [out] = touchPath([custom], "/a", 9);
    expect(out.label).toBe("Beamline 4");
    expect(out.pinned).toBe(true);
    expect(out.usedAt).toBe(9);
  });
});

describe("the store", () => {
  beforeEach(() => {
    localStorage.clear();
    useWorkingPaths.setState({ paths: [], current: "" });
  });

  it("records a used path and makes it current", () => {
    useWorkingPaths.getState().use("/data/xrd", 1);
    expect(useWorkingPaths.getState().current).toBe("/data/xrd");
    expect(useWorkingPaths.getState().paths[0].label).toBe("xrd");
  });

  it("ignores an empty path", () => {
    useWorkingPaths.getState().use("", 1);
    expect(useWorkingPaths.getState().paths).toHaveLength(0);
  });

  it("pins, renames and removes", () => {
    const s = useWorkingPaths.getState();
    s.use("/data/xrd", 1);
    s.setPinned("/data/xrd", true);
    expect(useWorkingPaths.getState().paths[0].pinned).toBe(true);
    s.rename("/data/xrd", "Beamline 4");
    expect(useWorkingPaths.getState().paths[0].label).toBe("Beamline 4");
    s.remove("/data/xrd");
    expect(useWorkingPaths.getState().paths).toHaveLength(0);
  });

  it("falls back to the segment name when a rename is blanked", () => {
    const s = useWorkingPaths.getState();
    s.use("/data/xrd", 1);
    s.rename("/data/xrd", "   ");
    expect(useWorkingPaths.getState().paths[0].label).toBe("xrd");
  });

  it("clears `current` when the current path is removed", () => {
    // Otherwise the next dialog opens at a folder the user just discarded.
    const s = useWorkingPaths.getState();
    s.use("/data/xrd", 1);
    s.remove("/data/xrd");
    expect(useWorkingPaths.getState().current).toBe("");
  });

  it("persists across a reload", () => {
    useWorkingPaths.getState().use("/data/xrd", 1);
    const raw = localStorage.getItem(WORKING_PATHS_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).paths[0].path).toBe("/data/xrd");
  });
});
