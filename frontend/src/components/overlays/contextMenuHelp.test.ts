import { createElement } from "react";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appendContextHelp } from "./contextMenuHelp";
import type { ContextMenuItem } from "./contextMenuTypes";
import HelpDialog from "./HelpDialog";
import { useHelp } from "../../store/help";

// Every .tsx under src/ that renders <ContextMenu>, read as raw text (the
// architecture.test.ts technique). Enumerating ALL hosts — rather than listing
// the ones that got a footer — is what makes this a ratchet: a new object
// menu without Help fails here until it either gets a footer or a written
// reason below.
const SOURCES = import.meta.glob("../../**/*.tsx", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;
const HOSTS = Object.entries(SOURCES).filter(
  ([path, src]) => !/\.test\.tsx$/.test(path) && /<ContextMenu\s+[a-z]/.test(src),
);
const count = (src: string, re: RegExp) => (src.match(re) ?? []).length;
const MENU_JSX = /<ContextMenu\s+[a-z]/g;
const HELP_PROP = /help=\{\{/g;

// Hosts that deliberately carry NO footer, each with its reason. Keys are the
// glob's own (path relative to this file).
const EXEMPT: Readonly<Record<string, string>> = {
  // The draw-shape kind chooser and the "Group labels" options flyout are
  // one-decision chooser popovers off a toolbar button, not object menus.
  "../Stage/PlotToolbar.tsx": "chooser flyouts",
  // The row "⋯" overflow lives inside the Recipe Library ToolWindow, whose
  // title-bar `?` already opens Recipe Library help (lib/workshopHelp.ts).
  "../workshops/recipelibrary/RecipeRowActions.tsx": "inside a workshop that has its own ? link",
};

// Where each seeded query LANDS: the first Help topic it lists. A footer that
// merely finds *something* is not enough — the first cut seeded "folder",
// whose only hits were "Save workspace", "Remove all", "Duplicate active
// dataset" and "Save the whole project", and "annotation"/"draw", whose top
// hits were fuzzy-title noise ("Tables > Join", "Graph Builder").
const QUERY_TOP: Readonly<Record<string, string>> = {
  dataset: "Join datasets by key",
  "library items": "Library items",
  "library folders": "Library folders",
  "library workbooks": "Library workbooks",
  "graph window": "Graph windows saved in the project",
  plot: "Show plot",
  worksheet: "Transpose worksheet",
  "plot window": "Plot in new window",
  "text box": "Text box",
  "text formatting": "Text formatting",
  "draw a": "Arrow",
  "multi-panel": "Multi-panel export",
  publication: "Publication preview",
};

const seeded = [
  ...new Set(HOSTS.flatMap(([, src]) => [...src.matchAll(/help=\{\{[^}]*query: "([^"]+)"/g)].map((m) => m[1]))),
];

afterEach(() => {
  cleanup();
  useHelp.getState().closeHelp();
});

describe("context-menu Help coverage", () => {
  it("finds the real hosts (guards the scan itself)", () => {
    expect(HOSTS.length).toBeGreaterThanOrEqual(15);
    for (const path of Object.keys(EXEMPT)) expect(HOSTS.map(([p]) => p)).toContain(path);
  });

  it.each(HOSTS.map(([path]) => path))("%s gives every ContextMenu a Help footer (or is exempt)", (path) => {
    const src = SOURCES[path];
    const expected = path in EXEMPT ? 0 : count(src, MENU_JSX);
    expect(count(src, HELP_PROP)).toBe(expected);
  });

  it("every seeded query has a pinned landing topic, and no pin is stale", () => {
    expect([...seeded].sort()).toEqual(Object.keys(QUERY_TOP).sort());
  });

  it.each(Object.entries(QUERY_TOP))("query %j lands on %j first", (query, top) => {
    useHelp.getState().openTopic(query);
    const { container } = render(createElement(HelpDialog));
    expect(container.querySelector(".qzk-help-title")?.textContent).toBe(top);
  });

  // PRIMARY ~6040: the Library, folder and workbook footers used to land on
  // "Toggle library panel" because Help had no Library topic at all.
  it.each([
    ["library", "Library items"],
    ["folder", "Library folders"],
    ["workbook", "Library workbooks"],
  ])("Help search %j finds the %j topic", (query, title) => {
    useHelp.getState().openTopic(query);
    const { container } = render(createElement(HelpDialog));
    const titles = [...container.querySelectorAll(".qzk-help-title")].map((el) => el.textContent);
    expect(titles).toContain(title);
  });
});

describe("appendContextHelp", () => {
  const help = { label: "things", query: "thing" };

  it("returns the host's items untouched when no help is given", () => {
    const items: ContextMenuItem[] = [{ label: "A", run: vi.fn() }];
    expect(appendContextHelp(items, undefined)).toBe(items);
  });

  it("separates the footer from the host's items with exactly one rule", () => {
    const out = appendContextHelp([{ label: "A", run: vi.fn() }], help);
    expect(out.map((it) => ("separator" in it ? "—" : "label" in it ? it.label : "?"))).toEqual([
      "A",
      "—",
      "Help with things…",
    ]);
  });

  it("does not double a trailing separator, and adds none to an empty menu", () => {
    const trailing = appendContextHelp([{ label: "A", run: vi.fn() }, { separator: true }], help);
    expect(trailing.filter((it) => "separator" in it)).toHaveLength(1);
    expect(appendContextHelp([], help)).toHaveLength(1);
  });
});
