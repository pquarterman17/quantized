import { afterEach, describe, expect, it } from "vitest";

import { loadPrefs, LIBRARY_PANEL_WIDTH_MAX, LIBRARY_PANEL_WIDTH_MIN } from "./prefs";
import { useApp } from "./useApp";
import { fmtNum } from "../lib/format";

afterEach(() => {
  // Reset the prefs we touch so other suites see defaults.
  const s = useApp.getState();
  s.setPref("sigFigs", 6);
  s.setPref("notation", "auto");
  s.setPref("reduceMotion", false);
  s.setPref("confirmRemove", false);
  s.setPref("excludedDisplay", "hide");
  s.setPref("originBookClickOpens", "worksheet");
  s.setPref("defaultPanelFit", "frames");
  s.setPref("libraryPanelWidth", 210);
});

describe("preferences", () => {
  it("setPref persists the full prefs object to qz.prefs", () => {
    useApp.getState().setPref("confirmRemove", true);
    const saved = JSON.parse(localStorage.getItem("qz.prefs") ?? "{}");
    expect(saved.confirmRemove).toBe(true);
    // appearance prefs ride along in the same blob
    expect(saved.theme).toBeTruthy();
  });

  it("reduceMotion toggles the <html> attribute", () => {
    useApp.getState().setPref("reduceMotion", true);
    expect(document.documentElement.dataset.reduceMotion).toBe("");
    useApp.getState().setPref("reduceMotion", false);
    expect(document.documentElement.dataset.reduceMotion).toBeUndefined();
  });

  it("sig-figs + notation prefs flow into the shared number formatter", () => {
    useApp.getState().setPref("sigFigs", 3);
    expect(fmtNum(1234.5678)).toBe("1230");
    useApp.getState().setPref("notation", "scientific");
    expect(fmtNum(3)).toBe("3.00e+0");
  });

  it("excludedDisplay defaults to hide and persists when changed to grey", () => {
    expect(useApp.getState().excludedDisplay).toBe("hide");
    useApp.getState().setPref("excludedDisplay", "grey");
    expect(useApp.getState().excludedDisplay).toBe("grey");
    expect(JSON.parse(localStorage.getItem("qz.prefs") ?? "{}").excludedDisplay).toBe("grey");
  });

  it("originBookClickOpens (WORKSHEET_PLAN item 15) defaults to worksheet and persists when changed to plot", () => {
    expect(useApp.getState().originBookClickOpens).toBe("worksheet");
    useApp.getState().setPref("originBookClickOpens", "plot");
    expect(useApp.getState().originBookClickOpens).toBe("plot");
    expect(JSON.parse(localStorage.getItem("qz.prefs") ?? "{}").originBookClickOpens).toBe("plot");
  });

  it("defaultPanelFit (#54) defaults to frames and persists when changed to window", () => {
    expect(useApp.getState().defaultPanelFit).toBe("frames");
    useApp.getState().setPref("defaultPanelFit", "window");
    expect(useApp.getState().defaultPanelFit).toBe("window");
    expect(JSON.parse(localStorage.getItem("qz.prefs") ?? "{}").defaultPanelFit).toBe("window");
  });

  it("libraryPanelWidth (#13 sub-item 5) defaults to 210 and persists + applies --lw on change", () => {
    expect(useApp.getState().libraryPanelWidth).toBe(210);
    useApp.getState().setPref("libraryPanelWidth", 260);
    expect(useApp.getState().libraryPanelWidth).toBe(260);
    expect(JSON.parse(localStorage.getItem("qz.prefs") ?? "{}").libraryPanelWidth).toBe(260);
    expect(document.documentElement.style.getPropertyValue("--lw")).toBe("260px");
  });

  it("libraryPanelWidth clamps out-of-range values on load", () => {
    localStorage.setItem("qz.prefs", JSON.stringify({ libraryPanelWidth: 9999 }));
    expect(loadPrefs().libraryPanelWidth).toBe(LIBRARY_PANEL_WIDTH_MAX);
    localStorage.setItem("qz.prefs", JSON.stringify({ libraryPanelWidth: 1 }));
    expect(loadPrefs().libraryPanelWidth).toBe(LIBRARY_PANEL_WIDTH_MIN);
  });
});
