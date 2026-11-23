// View ▸ "Window layout (preview)" (WORKSPACE_LAYOUT_PLAN P1): a checked
// toggle that switches layoutMode both ways and persists it in qz.prefs.
import { beforeEach, describe, expect, it } from "vitest";

import { PREFS_KEY } from "../store/prefs";
import { useApp } from "../store/useApp";
import { buildLayoutModeCommands } from "./layoutModeCommands";

const toggle = () => buildLayoutModeCommands(useApp.getState).find((a) => a.id === "window-layout-preview")!;
const saved = () => JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}").layoutMode;

beforeEach(() => {
  localStorage.clear();
  useApp.setState({ layoutMode: "classic", windowLayout: null });
});

describe("Window layout (preview) toggle", () => {
  it("is off by default, sits in View, and turns windows mode on, persisted", async () => {
    const a = toggle();
    expect(a.group).toBe("View");
    expect((a.checked as () => boolean)()).toBe(false);
    a.run();
    await expect.poll(() => useApp.getState().layoutMode).toBe("windows");
    expect(saved()).toBe("windows");
    expect(useApp.getState().windowLayout).not.toBeNull();
    expect((toggle().checked as () => boolean)()).toBe(true);
  });

  it("turns it off again, keeping the layout for the next time", async () => {
    toggle().run();
    await expect.poll(() => useApp.getState().layoutMode).toBe("windows");
    const kept = useApp.getState().windowLayout;
    toggle().run();
    await expect.poll(() => useApp.getState().layoutMode).toBe("classic");
    expect(saved()).toBe("classic");
    expect(useApp.getState().windowLayout).toBe(kept);
  });

  it("⌘K offers 'Switch to the classic layout' only while the layout is on (palette-only)", async () => {
    const classic = () => buildLayoutModeCommands(useApp.getState).find((a) => a.id === "window-layout-classic")!;
    expect(classic().paletteOnly).toBe(true);
    expect((classic().disabled as () => boolean)()).toBe(true);
    toggle().run();
    await expect.poll(() => useApp.getState().layoutMode).toBe("windows");
    expect((classic().disabled as () => boolean)()).toBe(false);
    classic().run();
    await expect.poll(() => useApp.getState().layoutMode).toBe("classic");
  });
});
