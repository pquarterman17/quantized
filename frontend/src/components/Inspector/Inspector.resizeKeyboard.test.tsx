// The Inspector splitter is a focusable separator, resized by keyboard and
// pointer — the mirror of Library.resizeKeyboard.test.tsx (ArrowLeft WIDENS:
// the panel is on the right).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import Inspector from "./Inspector";
import { floatingX } from "../overlays/floatingX";
import { INSPECTOR_PANEL_WIDTH_DEFAULT, loadPrefs } from "../../store/prefs";
import { useApp } from "../../store/useApp";

const NAME = "Resize Inspector panel";

beforeEach(() => {
  useApp.getState().setPref("inspectorPanelWidth", 320);
});

describe("Inspector splitter keyboard", () => {
  it("is a focusable separator exposing its width", () => {
    render(<Inspector />);
    const sep = screen.getByRole("separator", { name: NAME });
    expect(sep).toHaveAttribute("tabindex", "0");
    expect(sep).toHaveAttribute("aria-valuenow", "320");
    expect(sep).toHaveAttribute("aria-valuemin", "240");
    expect(sep).toHaveAttribute("aria-valuemax", "560");
  });

  it("ArrowLeft widens, ArrowRight narrows, clamped; double-click resets", () => {
    render(<Inspector />);
    const sep = screen.getByRole("separator", { name: NAME });
    fireEvent.keyDown(sep, { key: "ArrowLeft" });
    expect(useApp.getState().inspectorPanelWidth).toBe(336);
    expect(sep).toHaveAttribute("aria-valuenow", "336");
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    expect(useApp.getState().inspectorPanelWidth).toBe(304);
    useApp.getState().setPref("inspectorPanelWidth", 240);
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    expect(useApp.getState().inspectorPanelWidth).toBe(240);
    useApp.getState().setPref("inspectorPanelWidth", 560);
    fireEvent.keyDown(sep, { key: "ArrowLeft" });
    expect(useApp.getState().inspectorPanelWidth).toBe(560);
    fireEvent.doubleClick(sep);
    expect(useApp.getState().inspectorPanelWidth).toBe(INSPECTOR_PANEL_WIDTH_DEFAULT);
  });

  it("dragging left widens, streams --rw live and persists on release", () => {
    render(<Inspector />);
    const sep = screen.getByRole("separator", { name: NAME });
    fireEvent.pointerDown(sep, { clientX: 1000 });
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 960 }));
    expect(document.documentElement.style.getPropertyValue("--rw")).toBe("360px");
    window.dispatchEvent(new MouseEvent("pointerup"));
    expect(useApp.getState().inspectorPanelWidth).toBe(360);
    expect(loadPrefs().inspectorPanelWidth).toBe(360);
  });

  it("tool-window placement reads the live width", () => {
    const before = floatingX(300);
    useApp.getState().setPref("inspectorPanelWidth", 400);
    expect(before - floatingX(300)).toBe(80);
  });
});
