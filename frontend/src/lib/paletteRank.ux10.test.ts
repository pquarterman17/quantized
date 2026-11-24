// UX audit 10 (P1-11): the words a person types for Preferences and the theme
// must put those commands first, ranked against the REAL registry plus the
// commands the window hook publishes at runtime (where "Window Background
// (Theme / Light / Dark)" and "Close window" live).
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { buildAppActions } from "../appCommands";
import { useWindowCommands } from "../components/windows/useWindowCommands";
import { buildHistoryActions } from "../components/history/useHistoryCommands";
import { mergeCommands, useCommands } from "../store/commands";
import { useApp } from "../store/useApp";
import { contextPaletteActions } from "./paletteContextActions";
import { PALETTE_ALIASES } from "./paletteSynonyms";
import { rankActions } from "./paletteRank";

useApp.setState({ datasets: [{ id: "d1", name: "Alpha", data: { time: [1], values: [[1]], labels: ["m"], units: [""], metadata: {} } }], activeId: "d1" });
renderHook(() => useWindowCommands());
const REAL = mergeCommands(
  [...buildAppActions(useApp.getState), ...buildHistoryActions("add dataset", null)],
  [...useCommands.getState().menuCommands, ...contextPaletteActions()],
);
const top = (q: string, n: number) => rankActions(REAL, q).slice(0, n).map((r) => r.a.id);

describe("palette ranking: settings and theme words (UX10-C)", () => {
  it("the real registry holds the commands the tests name", () => {
    const ids = new Set(REAL.map((a) => a.id));
    for (const id of ["preferences", "theme", "window-close", "window-bg-cycle", "y-axis-settings"]) expect(ids.has(id), id).toBe(true);
  });

  it.each([
    ["settings", "preferences", 1],
    ["preferences", "preferences", 1],
    ["options", "preferences", 1],
    ["dark", "theme", 1],
    ["light", "theme", 1],
    ["dark mode", "theme", 1],
    ["theme", "theme", 1],
    ["close", "window-close", 1],
  ])("%s -> %s in the top %i", (q, id, n) => {
    expect(top(q, n)).toContain(id);
  });

  it("'settings' no longer lets Y Axis Settings crowd Preferences out", () => {
    const ids = top("settings", 3);
    expect(ids[0]).toBe("preferences");
    expect(ids).toContain("y-axis-settings"); // still found, just second
  });

  it("'dark' beats the Window Background command that also spells the word", () => {
    const ids = top("dark", 2);
    expect(ids[0]).toBe("theme");
    expect(ids).toContain("window-bg-cycle");
  });

  it("every alias names a command that exists", () => {
    const ids = new Set(REAL.map((a) => a.id));
    for (const [word, named] of Object.entries(PALETTE_ALIASES)) for (const id of named) expect(ids.has(id), `${word} -> ${id}`).toBe(true);
  });

  it("an alias does not capture a longer query", () => {
    expect(top("close window", 1)).not.toContain("preferences");
    expect(rankActions(REAL, "dark graph").slice(0, 1).map((r) => r.a.id)).not.toContain("theme");
  });
});
