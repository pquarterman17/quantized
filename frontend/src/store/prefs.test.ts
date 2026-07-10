import { afterEach, describe, expect, it } from "vitest";

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
});
