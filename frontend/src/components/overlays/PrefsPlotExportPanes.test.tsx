// PREFS_AUDIT lane 2 in the dialog: the Plot tab's style rows (palette and
// Vary dash share the Appearance gear's state) and the new Export tab.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { exportPrefsSlot, EXPORT_PREF_DEFAULTS } from "../../lib/exportPrefs";
import { PLOT_STYLE_DEFAULTS, plotStylePrefsSlot } from "../../lib/plotStylePrefs";
import { useApp } from "../../store/useApp";
import PreferencesDialog, { PREFS_DIALOG_KEY } from "./PreferencesDialog";
import { PREFS_TABS } from "./prefsTabs";

const open = (tab = "Plot") => {
  useApp.getState().setPrefsOpen(true);
  const r = render(<PreferencesDialog />);
  fireEvent.click(screen.getByRole("tab", { name: tab }));
  return r;
};

beforeEach(() => localStorage.removeItem(PREFS_DIALOG_KEY));
afterEach(() => {
  useApp.getState().setPrefsOpen(false);
  plotStylePrefsSlot.reset();
  exportPrefsSlot.reset();
  useApp.getState().setPalette("default");
  useApp.getState().setPref("autoSeriesStyles", false);
});

describe("Plot tab", () => {
  it("palette and Vary dash share state with the Appearance gear (store fields)", () => {
    open();
    fireEvent.change(screen.getByLabelText("Series palette"), { target: { value: "okabe-ito" } });
    expect(useApp.getState().palette).toBe("okabe-ito");
    fireEvent.click(screen.getByLabelText("Vary dash and marker"));
    expect(useApp.getState().autoSeriesStyles).toBe(true);
    act(() => useApp.getState().setPalette("default")); // changed from the gear: the dialog follows
    expect((screen.getByLabelText("Series palette") as HTMLSelectElement).value).toBe("default");
  });

  it("marker size, font size, tick direction and legend position write the slot", () => {
    open();
    expect(plotStylePrefsSlot.load()).toEqual(PLOT_STYLE_DEFAULTS);
    fireEvent.change(screen.getByLabelText("Marker size"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Font size"), { target: { value: "14" } });
    fireEvent.change(screen.getByLabelText("Tick direction"), { target: { value: "in" } });
    fireEvent.change(screen.getByLabelText("Legend position"), { target: { value: "se" } });
    expect(plotStylePrefsSlot.load()).toEqual({ markerSize: 8, fontSize: 14, tickDirection: "in", legendPos: "se" });
  });

  it("Reset tab restores the style slot, palette and Vary dash", () => {
    const plot = PREFS_TABS.find((t) => t.id === "Plot")!;
    plotStylePrefsSlot.save({ ...PLOT_STYLE_DEFAULTS, markerSize: 9 });
    useApp.getState().setPalette("okabe-ito");
    expect(plot.reset?.slots).toContain(plotStylePrefsSlot);
    expect(plot.reset?.prefs).toEqual(expect.arrayContaining(["palette", "autoSeriesStyles"]));
  });
});

describe("Export tab", () => {
  it("is registered, with every row label in its keywords", () => {
    const tab = PREFS_TABS.find((t) => t.id === "Export")!;
    for (const l of ["Default format", "Default size", "Raster DPI", "Transparent background", "Text as paths"]) expect(tab.keywords).toContain(l);
    expect(tab.reset?.slots).toContain(exportPrefsSlot);
  });

  it("shows the defaults (vector PDF) and writes each pref", () => {
    open("Export");
    expect((screen.getByLabelText("Default export format") as HTMLSelectElement).value).toBe("pdf");
    fireEvent.change(screen.getByLabelText("Default export format"), { target: { value: "svg" } });
    fireEvent.change(screen.getByLabelText("Default export size"), { target: { value: "aps" } });
    fireEvent.change(screen.getByLabelText("Default export DPI"), { target: { value: "300" } });
    fireEvent.click(screen.getByLabelText("Transparent export background"));
    fireEvent.click(screen.getByLabelText("Export text as paths"));
    expect(exportPrefsSlot.load()).toEqual({ ...EXPORT_PREF_DEFAULTS, format: "svg", stylePreset: "aps", dpi: 300, transparent: true, textAsPaths: true });
  });
});
