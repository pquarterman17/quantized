import { describe, expect, it, vi } from "vitest";

import { buildFileCommands } from "./fileCommands";
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
});
