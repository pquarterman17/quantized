// The window-layout slice (WORKSPACE_LAYOUT_PLAN P0): the opt-in mode, the
// first-switch seed, the per-user template, undo leaving placements alone, and
// loadWorkspace replacing the project's layout.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";

import { dock, emptyLayout, float } from "../lib/windowLayout/ops";
import { WINDOW_LAYOUT_TEMPLATE_KEY } from "../lib/windowLayout/template";
import type { WindowLayoutV1 } from "../lib/windowLayout/types";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import type { Dataset } from "../lib/types";
import { loadPrefs, PREFS_KEY } from "./prefs";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

const s = () => useApp.getState();
const makeDataset = ({ id, name }: { id: string; name: string }): Dataset => ({
  id, name, data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: {} },
});
const layoutA = (): WindowLayoutV1 => dock(emptyLayout(), "data", "right");
const layoutB = (): WindowLayoutV1 => float(layoutA(), "tool:curvefit");

beforeEach(() => {
  localStorage.clear();
  useApp.setState({ windowLayout: null, layoutMode: "classic", plotWindows: [], history: [], future: [] });
});
afterEach(() => {
  localStorage.clear();
  (window as { innerWidth: number }).innerWidth = 1024;
});

describe("layoutMode (opt-in, default classic)", () => {
  it("defaults to classic: a blob without it, or with anything but \"windows\", fails closed", () => {
    expect(loadPrefs().layoutMode).toBe("classic");
    localStorage.setItem(PREFS_KEY, JSON.stringify({ layoutMode: "tiles" }));
    expect(loadPrefs().layoutMode).toBe("classic");
    localStorage.setItem(PREFS_KEY, JSON.stringify({ layoutMode: "windows" }));
    expect(loadPrefs().layoutMode).toBe("windows");
  });

  it("the first switch to windows seeds a layout from the classic desk and persists the pref", async () => {
    useApp.setState({ plotWindows: [{ id: "win-x-1", z: 1, winState: "maximized" } as never] });
    (window as { innerWidth: number }).innerWidth = 1440;
    await expect(s().setLayoutMode("windows")).resolves.toBe("windows");
    expect(s().layoutMode).toBe("windows");
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!).layoutMode).toBe("windows");
    const l = s().windowLayout!;
    expect(l.placements["plot:win-x-1"]!.slot).toBe("centre");
    expect(l.placements.style!.slot).toBe("right");
    expect(l.placements.data!.open).toBe(false);
  });

  it("m9: turning it on says once how to switch back, and a reload (already on) says nothing", async () => {
    useToasts.setState({ toasts: [] });
    await s().setLayoutMode("windows");
    const t = useToasts.getState().toasts;
    expect(t).toHaveLength(1);
    expect(t[0].msg).toMatch(/Window layout is on.*Classic layout/);
    t[0].action!.onClick();
    await expect.poll(() => s().layoutMode).toBe("classic");
    useToasts.setState({ toasts: [] });
    await s().setLayoutMode("classic"); // no change: silent
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("m8: on a screen under 1280 px wide the first seed floats everything (D6)", async () => {
    (window as { innerWidth: number }).innerWidth = 1100;
    useApp.setState({ plotWindows: [{ id: "win-x-1", z: 1, winState: "maximized" } as never] });
    await s().setLayoutMode("windows");
    const l = s().windowLayout!;
    expect(l.placements["plot:win-x-1"]!.slot).toBeNull();
    expect(l.placements.style!.slot).toBeNull();
  });

  it("switching back to classic keeps the layout, and switching on again restores it (no re-seed)", async () => {
    await s().setLayoutMode("windows");
    s().setWindowLayout(layoutB());
    const kept = s().windowLayout;
    await s().setLayoutMode("classic");
    expect(s().layoutMode).toBe("classic");
    expect(s().windowLayout).toBe(kept);
    await s().setLayoutMode("windows");
    expect(s().windowLayout).toBe(kept);
  });

  it("setting the mode it already has changes nothing", async () => {
    await expect(s().setLayoutMode("classic")).resolves.toBe("classic");
    expect(s().windowLayout).toBeNull();
    expect(localStorage.getItem(PREFS_KEY)).toBeNull();
  });
});

describe("setWindowLayout and the qz.windowLayout template", () => {
  it("in windows mode the layout's shape is remembered as the per-user template", async () => {
    await s().setLayoutMode("windows");
    s().setWindowLayout(layoutA());
    await waitFor(() => expect(JSON.parse(localStorage.getItem(WINDOW_LAYOUT_TEMPLATE_KEY) ?? "null")?.kinds?.data?.slot).toBe("right"));
  });

  it("in classic mode nothing is remembered (a loaded project's layout is not the user's)", async () => {
    s().setWindowLayout(layoutA());
    expect(s().windowLayout).toEqual(layoutA());
    await Promise.resolve();
    expect(localStorage.getItem(WINDOW_LAYOUT_TEMPLATE_KEY)).toBeNull();
  });
});

describe("the layout is working state, never an undo step", () => {
  it("undo after a layout change restores the edit, not the placements", () => {
    s().addDataset(makeDataset({ id: "d1", name: "one" }));
    s().setWindowLayout(layoutB());
    const before = s().history.length;
    s().undo();
    expect(s().history.length).toBe(before - 1);
    expect(s().datasets.some((d) => d.id === "d1")).toBe(false);
    expect(s().windowLayout).toEqual(layoutB());
  });

  it("setting a layout records no history entry", () => {
    const before = s().history.length;
    s().setWindowLayout(layoutA());
    expect(s().history.length).toBe(before);
  });
});

describe("projects carry their own layout", () => {
  const text = (layout: WindowLayoutV1 | null) =>
    serializeWorkspace({ datasets: [makeDataset({ id: "d1", name: "one" })], layoutMode: "windows", windowLayout: layout });

  it("opening a project replaces the layout with the project's, or with none", () => {
    s().setWindowLayout(layoutA());
    s().loadWorkspace(parseWorkspace(text(layoutB())));
    expect(s().windowLayout).toEqual(layoutB());
    s().loadWorkspace(parseWorkspace(text(null)));
    expect(s().windowLayout).toBeNull();
  });

  it("Open without layout drops the project's layout too", () => {
    s().setWindowLayout(layoutA());
    s().loadWorkspace(parseWorkspace(text(layoutB())), { skipLayout: true });
    expect(s().windowLayout).toBeNull();
  });

  it("a classic session's save carries no layout, a windows session's does", async () => {
    s().setWindowLayout(layoutA());
    expect(JSON.parse(serializeWorkspace(s())).windowLayout).toBeUndefined();
    await s().setLayoutMode("windows");
    expect(JSON.parse(serializeWorkspace(s())).windowLayout).toEqual(layoutA());
  });
});
