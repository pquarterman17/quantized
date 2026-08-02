import { describe, expect, it, vi } from "vitest";

import { buildFileCommands } from "./fileCommands";
import { fuzzy } from "../lib/fuzzy";
import { useApp } from "../store/useApp";

describe("Publication Preview command", () => {
  it("opens a canonical session when possible and a safe compatibility preview otherwise", () => {
    const setFigureBuilderOpen = vi.fn();
    const beginFigurePublicationEdit = vi.fn().mockReturnValue(false);
    const setStatus = vi.fn();
    useApp.setState({ figurePublicationSession: null, setFigureBuilderOpen, beginFigurePublicationEdit, setStatus });
    const command = buildFileCommands(useApp.getState).find((item) => item.id === "figure-builder");

    expect(command).toMatchObject({
      label: "Publication preview…",
      description: expect.stringContaining("Apply updates that figure"),
    });

    command?.run();
    expect(beginFigurePublicationEdit).toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith("opened Publication Preview without an editable plot document");
    expect(setFigureBuilderOpen).toHaveBeenCalledWith(true);
  });

  it("begins a canonical focused-window session before falling back", () => {
    const setFigureBuilderOpen = vi.fn();
    const beginFigurePublicationEdit = vi.fn().mockReturnValue(true);
    useApp.setState({ setFigureBuilderOpen, beginFigurePublicationEdit });
    buildFileCommands(useApp.getState).find((item) => item.id === "figure-builder")?.run();
    expect(beginFigurePublicationEdit).toHaveBeenCalled();
    expect(setFigureBuilderOpen).not.toHaveBeenCalled();
  });

  it("preserves an active Publication Preview instead of invoking the legacy fallback", () => {
    const setFigureBuilderOpen = vi.fn();
    const beginFigurePublicationEdit = vi.fn().mockReturnValue(false);
    const setStatus = vi.fn();
    const session = { target: "new-editable" as const, windowId: null, baseline: {} as never, draft: {} as never };
    useApp.setState({ figurePublicationSession: session, setFigureBuilderOpen, beginFigurePublicationEdit, setStatus });

    buildFileCommands(useApp.getState).find((item) => item.id === "figure-builder")?.run();

    expect(beginFigurePublicationEdit).not.toHaveBeenCalled();
    expect(setFigureBuilderOpen).not.toHaveBeenCalled();
    expect(useApp.getState().figurePublicationSession).toBe(session);
    expect(setStatus).toHaveBeenCalledWith("finish or cancel the current Publication Preview before opening another");
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
