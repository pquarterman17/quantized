// Remember the last layout, end to end (WORKSPACE_LAYOUT_PLAN P6), on the
// repo's own synthetic `.dwk` fixtures: the per-user template lays out a
// project that has no layout of its own (a new project, an import, a file from
// before the window layout), and a project's own saved layout always wins over
// it, restored exactly. The same check runs over the private realdata corpus in
// windowLayoutRestore.corpus.test.ts (skipped without it).
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { emptyLayout } from "../lib/windowLayout/ops";
import { WINDOW_LAYOUT_TEMPLATE_KEY } from "../lib/windowLayout/template";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import { checkLayoutRestore, RESTORE_VIEWPORT, TEMPLATE_A } from "../test/layoutRestoreCheck";
import { useApp } from "./useApp";

const FIX = join(__dirname, "..", "lib", "__fixtures__");
const fixture = (...p: string[]): string => readFileSync(join(FIX, ...p), "utf8");
const s = () => useApp.getState();

beforeEach(() => {
  localStorage.clear();
  useApp.setState({ windowLayout: null, layoutMode: "classic", plotWindows: [], history: [], future: [] });
});
afterEach(() => {
  localStorage.clear();
  (window as { innerWidth: number }).innerWidth = 1024;
});

describe("opening a fixture project in windows mode", () => {
  it.each([
    ["v4.dwk.json (a file from before the window layout)", ["workspace", "v4.dwk.json"], false],
    ["v1.dwk.json (the oldest format)", ["workspace", "v1.dwk.json"], false],
    ["convertedWorkspace.dwk (an Origin project converted by qz convert)", ["convertedWorkspace.dwk"], false],
    ["v8-window-layout.dwk.json (saved with its own layout)", ["workspace", "v8-window-layout.dwk.json"], true],
  ])("%s: the template lays out a project without a layout; a saved layout wins and comes back exactly", async (label, path, own) => {
    const out = await checkLayoutRestore(fixture(...path), label);
    expect(out.hadOwn).toBe(own);
  });

  it("the v8 fixture's own placements are what opens, not the template's", async () => {
    localStorage.setItem(WINDOW_LAYOUT_TEMPLATE_KEY, JSON.stringify(TEMPLATE_A));
    const text = fixture("workspace", "v8-window-layout.dwk.json");
    const want = (JSON.parse(text) as { windowLayout: unknown }).windowLayout;
    useApp.setState({ layoutMode: "windows" });
    s().loadWorkspace(parseWorkspace(text, RESTORE_VIEWPORT));
    await s().setLayoutMode("windows");
    expect(s().windowLayout).toEqual(want);
  });

  it("with no template, a project without a layout gets the plain default seed (Style right, Data closed)", async () => {
    (window as { innerWidth: number }).innerWidth = 1600;
    useApp.setState({ layoutMode: "windows" });
    s().loadWorkspace(parseWorkspace(fixture("workspace", "v4.dwk.json"), RESTORE_VIEWPORT));
    await s().setLayoutMode("windows");
    const l = s().windowLayout!;
    expect(l.placements.style).toMatchObject({ slot: "right", open: true });
    expect(l.placements.data).toMatchObject({ slot: "right", open: false });
    expect(l.edges).toEqual(emptyLayout().edges);
  });

  it("an unreadable template is no template: the default seed, never a throw", async () => {
    (window as { innerWidth: number }).innerWidth = 1600;
    localStorage.setItem(WINDOW_LAYOUT_TEMPLATE_KEY, "{not json");
    useApp.setState({ layoutMode: "windows" });
    s().loadWorkspace(parseWorkspace(fixture("workspace", "v4.dwk.json"), RESTORE_VIEWPORT));
    await s().setLayoutMode("windows");
    expect(s().windowLayout!.placements.style).toMatchObject({ slot: "right", open: true });
  });

  it("a new project (Remove all) is laid out by the template too", async () => {
    localStorage.setItem(WINDOW_LAYOUT_TEMPLATE_KEY, JSON.stringify(TEMPLATE_A));
    useApp.setState({ layoutMode: "windows" });
    s().loadWorkspace(parseWorkspace(fixture("workspace", "v4.dwk.json"), RESTORE_VIEWPORT));
    s().clearAll();
    expect(s().windowLayout).toBeNull();
    await s().setLayoutMode("windows");
    expect(s().windowLayout!.placements.data).toMatchObject({ slot: "left", open: true });
    expect(s().windowLayout!.placements.style).toMatchObject({ slot: "bottom", open: true });
  });
});

describe("classic mode is unchanged by the template", () => {
  it("opening a project seeds nothing, and its save is byte-identical with or without a template", () => {
    const text = fixture("workspace", "v4.dwk.json");
    s().loadWorkspace(parseWorkspace(text, RESTORE_VIEWPORT));
    const without = serializeWorkspace({ ...s(), plotWindows: s().windowsForSave(), savedAt: "x" } as never);
    localStorage.setItem(WINDOW_LAYOUT_TEMPLATE_KEY, JSON.stringify(TEMPLATE_A));
    s().loadWorkspace(parseWorkspace(text, RESTORE_VIEWPORT));
    expect(s().windowLayout).toBeNull();
    const withT = serializeWorkspace({ ...s(), plotWindows: s().windowsForSave(), savedAt: "x" } as never);
    // The clock, and ids minted fresh on every open (pipeline steps, the default plot window).
    const norm = (t: string) => t.replace(/"savedAt": "[^"]*"/, "").replace(/step-[a-z0-9-]+|win-[a-z0-9]+-\d+/g, "id");
    expect(norm(withT)).toBe(norm(without));
    expect("windowLayout" in JSON.parse(withT)).toBe(false);
  });
});
