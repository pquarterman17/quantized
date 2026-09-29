// F4.2c (a): the one-click, always-visible "Excluded rows" toggle.
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ExcludedRowsToggle from "./ExcludedRowsToggle";
import StatusBar from "./StatusBar";
import { buildUiCommands } from "../../commands/uiCommands";
import { useApp } from "../../store/useApp";

afterEach(() => {
  useApp.getState().setPref("excludedDisplay", "grey");
});

describe("ExcludedRowsToggle (F4.2c (a))", () => {
  it("is a named toggle button whose pressed state is the app-wide mode", () => {
    useApp.getState().setPref("excludedDisplay", "grey");
    render(<ExcludedRowsToggle />);
    const btn = screen.getByRole("button", { name: "Grey excluded rows" });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.getAttribute("title")).toMatch(/greyed/);
  });

  // Audit item 4: the stat, polar, Graph Builder and QFB previews ignore the
  // preference, so the tooltip must not claim "every plot".
  it("tooltip claims only the XY plot windows that honour it, in one sentence", () => {
    render(<ExcludedRowsToggle />);
    const title = screen.getByRole("button", { name: "Grey excluded rows" }).getAttribute("title") ?? "";
    expect(title).not.toMatch(/every plot/);
    expect(title).toMatch(/XY plot windows/);
    expect(title.match(/\.(\s|$)/g)).toHaveLength(1);
  });

  it("one click flips the app-wide preference and re-renders with the new state", () => {
    useApp.getState().setPref("excludedDisplay", "grey");
    render(<ExcludedRowsToggle />);
    const btn = screen.getByRole("button", { name: "Grey excluded rows" });
    fireEvent.click(btn);
    expect(useApp.getState().excludedDisplay).toBe("hide");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(btn.getAttribute("title")).toMatch(/hidden/);
    fireEvent.click(btn);
    expect(useApp.getState().excludedDisplay).toBe("grey");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("is a view preference, not an undoable document edit", () => {
    const before = useApp.getState().history.length;
    render(<ExcludedRowsToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Grey excluded rows" }));
    expect(useApp.getState().history.length).toBe(before);
  });

  it("is always visible in the status bar, with or without a dataset", () => {
    useApp.setState({ datasets: [], activeId: null });
    render(<StatusBar />);
    expect(screen.getByRole("button", { name: "Grey excluded rows" })).toBeTruthy();
  });

  it("has a command-palette twin that toggles the same preference", () => {
    const cmd = buildUiCommands(useApp.getState).find((a) => a.id === "toggle-excluded-rows");
    expect(cmd?.label).toBe("Toggle greyed excluded rows");
    useApp.getState().setPref("excludedDisplay", "grey");
    void cmd!.run();
    expect(useApp.getState().excludedDisplay).toBe("hide");
    void cmd!.run();
    expect(useApp.getState().excludedDisplay).toBe("grey");
  });
});
