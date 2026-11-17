// UX9-H: the Library splitter is a focusable separator, resized by keyboard.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import Library from "./Library";
import { LIBRARY_PANEL_WIDTH_DEFAULT } from "../../store/prefs";
import { useApp } from "../../store/useApp";

beforeEach(() => {
  useApp.getState().setPref("libraryPanelWidth", 240);
});

describe("Library splitter keyboard", () => {
  it("is a focusable separator exposing its width", () => {
    render(<Library viewMode="tree" onViewModeChange={() => {}} />);
    const sep = screen.getByRole("separator", { name: "Resize Library panel" });
    expect(sep).toHaveAttribute("tabindex", "0");
    expect(sep).toHaveAttribute("aria-valuenow", "240");
    expect(sep).toHaveAttribute("aria-valuemin", "160");
    expect(sep).toHaveAttribute("aria-valuemax", "420");
  });

  it("arrows resize, clamped; double-click restores the default", () => {
    render(<Library viewMode="tree" onViewModeChange={() => {}} />);
    const sep = screen.getByRole("separator", { name: "Resize Library panel" });
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    expect(useApp.getState().libraryPanelWidth).toBe(256);
    useApp.getState().setPref("libraryPanelWidth", 160);
    fireEvent.keyDown(sep, { key: "ArrowLeft" });
    expect(useApp.getState().libraryPanelWidth).toBe(160);
    fireEvent.doubleClick(sep);
    expect(useApp.getState().libraryPanelWidth).toBe(LIBRARY_PANEL_WIDTH_DEFAULT);
  });
});
