// AppearanceMenu (standalone-DiraCulator audit, 2026-08-02, item 3): the
// dropdown is self-contained EXCEPT its "All preferences…" footer, which
// opens PreferencesDialog — not mounted in the calc-only shell (?view=calc,
// MAIN_PLAN #22). One guarded render (isCalcOnlyView()) hides just that
// footer link in calc-only mode; the accent/density/theme/palette controls
// and full-app behavior are unchanged either way.

import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import AppearanceMenu from "./AppearanceMenu";
import { useApp } from "../../store/useApp";
import { pressEscape } from "../../test/pressEscape";
import { useGlobalShortcuts } from "../../useGlobalShortcuts";

/** Open the dropdown and wait for its panel, a lazy chunk (AppearancePanel). */
async function open(): Promise<void> {
  fireEvent.click(screen.getByTitle("Appearance (theme · accent · density · palette)"));
  await screen.findByText("Accent");
}

afterEach(() => {
  window.history.pushState({}, "", "/");
  useApp.getState().setPref("autoSeriesStyles", false);
});

describe("AppearanceMenu — full app (default view)", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("shows the theme/accent/density/palette controls", async () => {
    render(<AppearanceMenu />);
    await open();
    expect(screen.getByText("Theme")).toBeInTheDocument();
    expect(screen.getByText("Accent")).toBeInTheDocument();
    expect(screen.getByText("Density")).toBeInTheDocument();
    expect(screen.getByText("Series palette")).toBeInTheDocument();
  });

  it('shows the "All preferences…" footer', async () => {
    render(<AppearanceMenu />);
    await open();
    expect(screen.getByText("All preferences…")).toBeInTheDocument();
  });

  // P3.3 non-colour encodings: the auto dash/marker cycle is opt-in from the
  // SAME menu the palette lives in (hue there, non-hue here). The markup is
  // hand-written rather than `primitives/Checkbox` (bundle — see the comment at
  // the call site), so this also pins that the hand-written version is still a
  // real labelled checkbox wired to `setPref`.
  it("offers the P3.3 dash/marker switch beside the palette, off by default, and writes the pref", async () => {
    render(<AppearanceMenu />);
    await open();
    const box = screen.getByLabelText("Vary dash & marker", { selector: "input" });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(useApp.getState().autoSeriesStyles).toBe(true);
  });
});

describe("AppearanceMenu — calc-only view (?view=calc)", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/?view=calc");
  });

  it("still shows the accent/density controls", async () => {
    render(<AppearanceMenu />);
    await open();
    expect(screen.getByText("Accent")).toBeInTheDocument();
    expect(screen.getByText("Density")).toBeInTheDocument();
  });

  it('hides the "All preferences…" footer (PreferencesDialog is not mounted there)', async () => {
    render(<AppearanceMenu />);
    await open();
    expect(screen.queryByText("All preferences…")).not.toBeInTheDocument();
  });
});

// ── ROUND 4 (review of round 3, NIT 7) ──────────────────────────────────
// Escape used to close this dropdown from a plain document-keydown with no
// `preventDefault`, so the shared Escape registry walked on the same keystroke
// and a surface below acted too. It is a `menu`-layer surface now.
describe("AppearanceMenu Escape ownership (P3.3 round 4)", () => {
  it("closes the dropdown and claims the key", async () => {
    useApp.setState({ plotTool: "zoom" });
    renderHook(() => useGlobalShortcuts());
    render(<AppearanceMenu />);
    fireEvent.click(screen.getByTitle(/Appearance/));
    expect(await screen.findByText("Theme")).toBeInTheDocument();

    await pressEscape();

    expect(screen.queryByText("Theme")).not.toBeInTheDocument();
    expect(useApp.getState().plotTool).toBe("zoom"); // ONLY the menu closed
  });
});
