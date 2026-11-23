// Fail closed (WORKSPACE_LAYOUT_PLAN P0): if the layout model's chunk will not
// load on the first switch, the mode stays classic, nothing is persisted, and
// the status line says why. Its own file because `vi.doMock` must be registered
// before the module's first load.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PREFS_KEY } from "./prefs";
import { useApp } from "./useApp";

beforeEach(() => {
  localStorage.clear();
  useApp.setState({ windowLayout: null, layoutMode: "classic", status: "", statusDanger: null });
});
afterEach(() => {
  vi.doUnmock("./windowLayoutRun");
  localStorage.clear();
});

describe("setLayoutMode: the seed chunk will not load", () => {
  it("stays classic, persists nothing and reports the failure", async () => {
    vi.doMock("./windowLayoutRun", () => {
      throw new Error("network error");
    });
    await expect(useApp.getState().setLayoutMode("windows")).resolves.toBe("classic");
    const s = useApp.getState();
    expect(s.layoutMode).toBe("classic");
    expect(s.windowLayout).toBeNull();
    expect(localStorage.getItem(PREFS_KEY)).toBeNull();
    expect(s.statusDanger).toMatch(/Window layout failed to load/);
  });

  it("a switch that throws after the chunk loads fails closed the same way", async () => {
    vi.doMock("./windowLayoutRun", () => ({
      switchLayoutMode: () => {
        throw new Error("bad seed");
      },
    }));
    await expect(useApp.getState().setLayoutMode("windows")).resolves.toBe("classic");
    expect(useApp.getState().layoutMode).toBe("classic");
    expect(useApp.getState().statusDanger).toMatch(/Window layout failed to load/);
  });
});
