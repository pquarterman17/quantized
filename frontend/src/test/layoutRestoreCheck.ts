// Shared test helper (WORKSPACE_LAYOUT_PLAN P6): open one `.dwk` project in
// windows mode the way the app does, and check the per-user template against
// the project's own layout. Used by the always-run fixture test
// (store/windowLayoutRestore.test.ts, the repo's synthetic `.dwk` fixtures) and
// by the realdata run (store/windowLayoutRestore.corpus.test.ts, projects
// converted from the private corpus, which never enters the repo).
//
// The steps, each through the real store and codec:
// 1. With template A remembered, open the project. A project with no layout of
//    its own is seeded the way the layout host seeds one (setLayoutMode, the
//    host's own call) and must come out laid out by A. A project with its own
//    layout must keep it, untouched by A.
// 2. Arrange a desk unlike A and unlike B, save the project (the app's own
//    save path: windowsForSave + serializeWorkspace).
// 3. With a DIFFERENT template B remembered, open the saved file: the
//    placements, floating stack, edges, centre mode and Data follow setting
//    come back exactly as saved. The project's layout wins over B.
import { expect } from "vitest";

import { dock, floatAll, reopen, stackOf } from "../lib/windowLayout/ops";
import { deskClassOf, WINDOW_LAYOUT_TEMPLATE_KEY, type WindowLayoutTemplateV1 } from "../lib/windowLayout/template";
import type { WindowLayoutV1, WindowRef } from "../lib/windowLayout/types";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import { windowLayoutForSave } from "../lib/workspaceWindowLayout";
import { useApp } from "../store/useApp";
import { checkInvariants } from "./windowLayoutInvariants";

export const RESTORE_VIEWPORT = { width: 1600, height: 1000 };

/** Template A: every kind somewhere the default seed does not put it. */
export const TEMPLATE_A: WindowLayoutTemplateV1 = {
  v: 1,
  kinds: {
    plot: { slot: "centre", open: true },
    data: { slot: "left", open: true },
    style: { slot: "bottom", open: true },
    analysis: { slot: null, open: false },
    tool: { slot: "right", open: true },
  },
  edges: { left: 310, right: 0, bottom: 190 },
  centre: "row",
};

/** Template B: different again, so a restore that consulted it would show. */
export const TEMPLATE_B: WindowLayoutTemplateV1 = {
  v: 1,
  kinds: { plot: { slot: null, open: true }, data: { slot: "right", open: false }, style: { slot: null, open: true }, analysis: { slot: "bottom", open: true } },
  edges: { left: 0, right: 450, bottom: 0 },
  centre: "grid",
};

const s = () => useApp.getState();
/** The stored form (version 2: one template per width class) of `t` as the desk of the window's current width class. */
export const storedTemplate = (t: WindowLayoutTemplateV1, width: number = window.innerWidth): string => JSON.stringify({ v: 2, [deskClassOf(width)]: t });
const remember = (t: WindowLayoutTemplateV1) => localStorage.setItem(WINDOW_LAYOUT_TEMPLATE_KEY, storedTemplate(t));

/** A desk neither template describes: everything floats, then Data docks bottom and Analysis opens
 *  on the left; odd edge sizes and the grid centre. */
function arrange(l: WindowLayoutV1): WindowLayoutV1 {
  const desk = reopen(dock(floatAll(l), "data", "bottom"), "analysis");
  return { ...dock(desk, "analysis", "left"), edges: { left: 287, right: 333, bottom: 211 }, centre: "grid" };
}

/** What the app saves for the open project, as text. */
function saveText(): string {
  return serializeWorkspace({ ...s(), plotWindows: s().windowsForSave() });
}

export interface RestoreOutcome {
  /** The project carried a layout of its own. */
  hadOwn: boolean;
  /** The placements the saved file carries (and the reopen must give back). */
  saved: WindowLayoutV1;
}

export async function checkLayoutRestore(text: string, label: string): Promise<RestoreOutcome> {
  (window as { innerWidth: number }).innerWidth = RESTORE_VIEWPORT.width;
  remember(TEMPLATE_A);
  useApp.setState({ layoutMode: "windows", windowLayout: null });
  s().loadWorkspace(parseWorkspace(text, RESTORE_VIEWPORT));
  const own = s().windowLayout;
  await s().setLayoutMode("windows"); // what the layout host does on mount (useLayoutSync)
  const opened = s().windowLayout!;
  if (own) {
    expect(opened, `${label}: its own layout`).toBe(own);
  } else {
    checkInvariants(opened);
    const focused = s().focusedWindowId ? (`plot:${s().focusedWindowId}` as WindowRef) : null;
    if (focused) expect(opened.placements[focused], `${label}: first plot`).toMatchObject({ slot: "centre", open: true });
    expect(stackOf(opened, "left"), `${label}: Data`).toContain("data");
    expect(stackOf(opened, "bottom"), `${label}: Style`).toContain("style");
    expect(opened.placements.analysis, `${label}: Analysis`).toMatchObject({ slot: null, open: false });
    expect(opened.edges, `${label}: edges`).toEqual(TEMPLATE_A.edges);
  }

  const desk = arrange(opened);
  checkInvariants(desk);
  s().setWindowLayout(desk);
  // The template follows the layout (asynchronously: its writer is lazy); wait on that STATE before B replaces it.
  await expect.poll(() => JSON.parse(localStorage.getItem(WINDOW_LAYOUT_TEMPLATE_KEY) ?? "null")?.[deskClassOf(window.innerWidth)]?.centre, { timeout: 5_000 }).toBe("grid");
  const saved = windowLayoutForSave(s())!;
  const file = saveText();
  expect(JSON.parse(file).windowLayout, `${label}: saved`).toEqual(saved);

  remember(TEMPLATE_B);
  useApp.setState({ windowLayout: null });
  s().loadWorkspace(parseWorkspace(file, RESTORE_VIEWPORT));
  await s().setLayoutMode("windows");
  const back = s().windowLayout!;
  expect(back, `${label}: restored exactly`).toEqual(saved);
  return { hadOwn: own !== null, saved };
}
