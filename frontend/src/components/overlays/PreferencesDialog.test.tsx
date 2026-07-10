import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import PreferencesDialog from "./PreferencesDialog";
import { useApp } from "../../store/useApp";

describe("PreferencesDialog", () => {
  beforeEach(() => useApp.getState().setPrefsOpen(false));
  afterEach(() => {
    useApp.getState().setPrefsOpen(false);
    useApp.getState().setTheme("dark");
  });

  it("renders nothing when closed", () => {
    const { container } = render(<PreferencesDialog />);
    expect(container.querySelector(".qzk-prefs")).toBeNull();
  });

  it("shows the tabs and switches panes", () => {
    useApp.getState().setPrefsOpen(true);
    render(<PreferencesDialog />);
    expect(screen.getByText("Preferences")).toBeInTheDocument();
    expect(screen.getByText("Reduce motion")).toBeInTheDocument(); // Appearance default
    fireEvent.click(screen.getByText("Numbers"));
    expect(screen.getByText("Significant figures")).toBeInTheDocument();
  });

  it("changing the theme applies live + updates the store", () => {
    useApp.getState().setPrefsOpen(true);
    render(<PreferencesDialog />);
    fireEvent.click(screen.getByText("Light"));
    expect(useApp.getState().theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("Origin book click opens (WORKSHEET_PLAN item 15) defaults to Worksheet and can switch to Plot", () => {
    useApp.getState().setPrefsOpen(true);
    render(<PreferencesDialog />);
    fireEvent.click(screen.getByText("Interaction"));
    expect(useApp.getState().originBookClickOpens).toBe("worksheet");
    const worksheetBtn = screen.getByRole("tab", { name: "Worksheet" });
    expect(worksheetBtn).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Plot" }));
    expect(useApp.getState().originBookClickOpens).toBe("plot");
    fireEvent.click(worksheetBtn);
    expect(useApp.getState().originBookClickOpens).toBe("worksheet");
  });

  it("closes via Done and Escape", () => {
    useApp.getState().setPrefsOpen(true);
    const { rerender } = render(<PreferencesDialog />);
    fireEvent.click(screen.getByText("Done"));
    expect(useApp.getState().prefsOpen).toBe(false);

    useApp.getState().setPrefsOpen(true);
    rerender(<PreferencesDialog />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().prefsOpen).toBe(false);
  });
});
