import { beforeEach, describe, expect, it } from "vitest";

import { useRecentProjects } from "./recentProjects";

beforeEach(() => {
  localStorage.clear();
  useRecentProjects.setState({ recentProjects: [] });
});

describe("useRecentProjects", () => {
  it("pushRecentProject prepends and persists", () => {
    useRecentProjects.getState().pushRecentProject("workspace.dwk", "/p/workspace.dwk");
    const list = useRecentProjects.getState().recentProjects;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "workspace.dwk", path: "/p/workspace.dwk" });
    expect(localStorage.getItem("qz.recentProjects")).not.toBeNull();
  });

  it("removeRecentProject drops one entry by path without touching the rest", () => {
    useRecentProjects.getState().pushRecentProject("a", "/a.dwk");
    useRecentProjects.getState().pushRecentProject("b", "/b.dwk");
    useRecentProjects.getState().removeRecentProject("/a.dwk");
    expect(useRecentProjects.getState().recentProjects.map((r) => r.path)).toEqual(["/b.dwk"]);
  });

  it("clearRecentProjects wipes the list and storage", () => {
    useRecentProjects.getState().pushRecentProject("a", "/a.dwk");
    useRecentProjects.getState().clearRecentProjects();
    expect(useRecentProjects.getState().recentProjects).toEqual([]);
    expect(localStorage.getItem("qz.recentProjects")).toBeNull();
  });

  it("re-pushing the same path bubbles it to the top instead of duplicating", () => {
    useRecentProjects.getState().pushRecentProject("a", "/a.dwk");
    useRecentProjects.getState().pushRecentProject("b", "/b.dwk");
    useRecentProjects.getState().pushRecentProject("a-renamed", "/a.dwk");
    const list = useRecentProjects.getState().recentProjects;
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ name: "a-renamed", path: "/a.dwk" });
  });
});
