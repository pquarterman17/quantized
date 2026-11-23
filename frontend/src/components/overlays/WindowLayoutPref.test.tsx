// Preferences ▸ Interaction ▸ "Window layout (preview)" (WORKSPACE_LAYOUT_PLAN
// P1): the same opt-in switch as the View menu, persisted in qz.prefs.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { PREFS_KEY } from "../../store/prefs";
import { useApp } from "../../store/useApp";
import { WindowLayoutPref } from "./WindowLayoutPref";

beforeEach(() => {
  localStorage.clear();
  useApp.setState({ layoutMode: "classic", windowLayout: null });
});

describe("WindowLayoutPref", () => {
  it("shows off by default and switches windows mode on and off, persisted", async () => {
    render(<WindowLayoutPref />);
    const sw = screen.getByRole("switch", { name: "Window layout (preview)" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    await expect.poll(() => useApp.getState().layoutMode).toBe("windows");
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!).layoutMode).toBe("windows");
    expect(screen.getByRole("switch", { name: "Window layout (preview)" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("switch", { name: "Window layout (preview)" }));
    await expect.poll(() => useApp.getState().layoutMode).toBe("classic");
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!).layoutMode).toBe("classic");
  });
});
