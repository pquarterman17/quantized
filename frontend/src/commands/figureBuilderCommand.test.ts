import { describe, expect, it, vi } from "vitest";

import { buildFileCommands } from "./fileCommands";
import { fuzzy } from "../lib/fuzzy";
import { useApp } from "../store/useApp";

describe("Publication Preview command", () => {
  it("describes the detached publication workflow before opening it", () => {
    const setFigureBuilderOpen = vi.fn();
    useApp.setState({ setFigureBuilderOpen });
    const command = buildFileCommands(useApp.getState).find((item) => item.id === "figure-builder");

    expect(command).toMatchObject({
      label: "Publication preview…",
      description: expect.stringContaining("do not update the editable Stage plot"),
    });

    command?.run();
    expect(setFigureBuilderOpen).toHaveBeenCalledWith(true);
  });

  it("identifies the multi-panel surface as a temporary export composition", () => {
    const setFigurePageOpen = vi.fn();
    useApp.setState({ setFigurePageOpen });
    const command = buildFileCommands(useApp.getState).find((item) => item.id === "figure-page");

    expect(command).toMatchObject({
      label: "Multi-panel export…",
      description: expect.stringContaining("Temporarily compose"),
    });

    command?.run();
    expect(setFigurePageOpen).toHaveBeenCalledWith(true);
  });

  // The F0.1/F0.4 renames must not orphan the legacy names in the palette or
  // Help — both search label + keywords with the same in-order fuzzy matcher
  // (the #78–#81 keyword-migration regression class). A label rename with no
  // `keywords` carrying the old term returns ZERO results for it.
  it.each([
    ["figure-builder", "figure builder"],
    ["figure-page", "figure page"],
  ])("%s stays findable by its legacy name %j", (id, legacyQuery) => {
    const command = buildFileCommands(useApp.getState).find((item) => item.id === id);
    expect(command).toBeDefined();
    // Same OR the palette applies: fuzzy label match, else fuzzy keywords match.
    const found =
      fuzzy(legacyQuery, command?.label ?? "") !== null ||
      fuzzy(legacyQuery, command?.keywords ?? "") !== null;
    expect(found).toBe(true);
  });
});
