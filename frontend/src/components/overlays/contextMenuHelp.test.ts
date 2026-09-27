import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import HelpDialog from "./HelpDialog";
import { useHelp } from "../../store/help";

// Ratchet the major object menus named by P3.1. Generic click-flyouts (colour
// and shape choosers) intentionally stay compact and are not part of this list.
const HOSTS: ReadonlyArray<[string, number]> = [
  ["../Library/DatasetRow.tsx", 1],
  ["../Library/DetailsRow.tsx", 1],
  ["../Library/FolderRow.tsx", 1],
  ["../Library/LibraryTree.tsx", 1],
  ["../Library/LibraryWorkspace.tsx", 1],
  ["../Library/WorkbookRow.tsx", 1],
  ["../Stage/PlotContextMenu.tsx", 1],
  ["../Stage/PlotLegend.tsx", 1],
  ["../Stage/PlotStageMenus.tsx", 3],
  ["../Stage/worksheet/WorksheetPane.tsx", 1],
  ["../windows/WindowTitleButtons.tsx", 2],
];
const hostSources = HOSTS.map(([relative]) => readFileSync(join(__dirname, relative), "utf8"));
const helpQueries = [...new Set(hostSources.flatMap((source) => [...source.matchAll(/help=\{\{[^}]*query: "([^"]+)"/g)].map((m) => m[1])))];

afterEach(() => {
  cleanup();
  useHelp.getState().closeHelp();
});

describe("context-menu Help coverage", () => {
  it.each(HOSTS)("keeps contextual Help on %s", (relative, expected) => {
    const source = readFileSync(join(__dirname, relative), "utf8");
    expect(source.match(/help=\{\{/g)).toHaveLength(expected);
  });

  it.each(helpQueries)("query %j opens to at least one real Help topic", (query) => {
    useHelp.getState().openTopic(query);
    render(createElement(HelpDialog));
    expect(screen.queryByText("No matching topics")).not.toBeInTheDocument();
  });
});
