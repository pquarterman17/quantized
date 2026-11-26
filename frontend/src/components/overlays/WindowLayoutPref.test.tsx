// Preferences ▸ Interaction ▸ "Window layout" (WORKSPACE_LAYOUT_PLAN
// P1): the same switch as the View menu, persisted in qz.prefs.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { PREFS_KEY } from "../../store/prefs";
import { useApp } from "../../store/useApp";
import { WindowLayoutPref } from "./WindowLayoutPref";

beforeEach(() => {
  localStorage.clear();
  useApp.setState({ layoutMode: "classic", windowLayout: null });
});

describe("WindowLayoutPref", () => {
  it("starts from an explicit classic layout and switches windows mode on and off, persisted", async () => {
    render(<WindowLayoutPref />);
    const sw = screen.getByRole("switch", { name: "Window layout" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    await expect.poll(() => useApp.getState().layoutMode).toBe("windows");
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!).layoutMode).toBe("windows");
    expect(screen.getByRole("switch", { name: "Window layout" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("switch", { name: "Window layout" }));
    await expect.poll(() => useApp.getState().layoutMode).toBe("classic");
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!).layoutMode).toBe("classic");
  });
});

// UX pass 4 m-7: the Small screens row states its range, says (visibly) when a typed width is refused instead of
// snapping back silently, keeps its controls in one tidy column, and says where the setting is kept.
describe("Small screens width", () => {
  const field = () => screen.getByRole("textbox", { name: "Tile below width (px)" }) as HTMLInputElement;
  beforeEach(() => useApp.setState({ layoutMode: "windows", windowLayout: null, layoutTileBelow: 1280 }));

  it("states the range and that it is per user", () => {
    render(<WindowLayoutPref />);
    expect(screen.getByText(/px \(600 to 3,840\)/)).toBeTruthy();
    expect(field().getAttribute("aria-describedby")).toBe("qzk-tile-range");
    expect(screen.getByText(/Saved for you, not with the project/)).toBeTruthy();
    // one column of controls (the segmented control, then the field), not a row that squeezes the label
    expect(document.querySelector(".qzk-pref-stack")).not.toBeNull();
  });

  it("a width outside the range is refused with a message that names the range and the width in force", () => {
    render(<WindowLayoutPref />);
    fireEvent.change(field(), { target: { value: "100" } });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Use a width from 600 to 3,840 px. Still tiling below 1280 px.");
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(useApp.getState().layoutTileBelow).toBe(1280);
    // leaving the field puts the old width back AND keeps saying so
    fireEvent.blur(field());
    expect(field().value).toBe("1280");
    expect(within(screen.getByRole("alert")).getByText(/Kept 1280 px: the width must be 600 to 3,840 px\./)).toBeTruthy();
  });

  it("a valid width is applied at once and clears the message", () => {
    render(<WindowLayoutPref />);
    fireEvent.change(field(), { target: { value: "99999" } });
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.change(field(), { target: { value: "900" } });
    expect(useApp.getState().layoutTileBelow).toBe(900);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(field().getAttribute("aria-invalid")).toBeNull();
  });

  it("an empty field is refused too (not read as zero)", () => {
    render(<WindowLayoutPref />);
    fireEvent.change(field(), { target: { value: "" } });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(useApp.getState().layoutTileBelow).toBe(1280);
  });
});
