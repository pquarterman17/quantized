// Project identity + dirty-state slice (P1.2 box 1). Exercised through
// useApp — see store/project.ts's header for why it is composed there
// rather than a standalone store (mirrors recents.ts's slice pattern).

import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "./useApp";

beforeEach(() => {
  useApp.setState({ currentProject: null, projectDirty: false });
});

describe("currentProject / projectDirty", () => {
  it("starts with no project and clean", () => {
    expect(useApp.getState().currentProject).toBeNull();
    expect(useApp.getState().projectDirty).toBe(false);
  });

  it("setCurrentProject records the identity and clears dirty", () => {
    useApp.getState().markProjectDirty();
    useApp.getState().setCurrentProject({ name: "workspace.dwk", path: "/proj/workspace.dwk" });
    expect(useApp.getState().currentProject).toEqual({
      name: "workspace.dwk",
      path: "/proj/workspace.dwk",
    });
    expect(useApp.getState().projectDirty).toBe(false);
  });

  it("markProjectDirty flips the flag without touching the identity", () => {
    useApp.getState().setCurrentProject({ name: "a.dwk", path: "/a.dwk" });
    useApp.getState().markProjectDirty();
    expect(useApp.getState().projectDirty).toBe(true);
    expect(useApp.getState().currentProject).toEqual({ name: "a.dwk", path: "/a.dwk" });
  });

  it("markProjectClean clears dirty without touching the identity", () => {
    useApp.getState().setCurrentProject({ name: "a.dwk", path: "/a.dwk" });
    useApp.getState().markProjectDirty();
    useApp.getState().markProjectClean();
    expect(useApp.getState().projectDirty).toBe(false);
    expect(useApp.getState().currentProject).toEqual({ name: "a.dwk", path: "/a.dwk" });
  });

  it("setCurrentProject(null) clears the identity (e.g. Remove all / new session)", () => {
    useApp.getState().setCurrentProject({ name: "a.dwk", path: "/a.dwk" });
    useApp.getState().setCurrentProject(null);
    expect(useApp.getState().currentProject).toBeNull();
  });
});
