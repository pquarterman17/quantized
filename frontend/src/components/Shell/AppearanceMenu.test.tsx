// AppearanceMenu (standalone-DiraCulator audit, 2026-08-02, item 3): the
// dropdown is self-contained EXCEPT its "All preferences…" footer, which
// opens PreferencesDialog — not mounted in the calc-only shell (?view=calc,
// MAIN_PLAN #22). One guarded render (isCalcOnlyView()) hides just that
// footer link in calc-only mode; the accent/density/theme/palette controls
// and full-app behavior are unchanged either way.

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import AppearanceMenu from "./AppearanceMenu";
import { useApp } from "../../store/useApp";

function open(): void {
  fireEvent.click(screen.getByTitle("Appearance (theme · accent · density · palette)"));
}

afterEach(() => {
  window.history.pushState({}, "", "/");
  useApp.getState().setPref("autoSeriesStyles", false);
});

describe("AppearanceMenu — full app (default view)", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("shows the theme/accent/density/palette controls", () => {
    render(<AppearanceMenu />);
    open();
    expect(screen.getByText("Theme")).toBeInTheDocument();
    expect(screen.getByText("Accent")).toBeInTheDocument();
    expect(screen.getByText("Density")).toBeInTheDocument();
    expect(screen.getByText("Series palette")).toBeInTheDocument();
  });

  it('shows the "All preferences…" footer', () => {
    render(<AppearanceMenu />);
    open();
    expect(screen.getByText("All preferences…")).toBeInTheDocument();
  });

  // P3.3 non-colour encodings: the auto dash/marker cycle is opt-in from the
  // SAME menu the palette lives in (hue there, non-hue here). The markup is
  // hand-written rather than `primitives/Checkbox` (bundle — see the comment at
  // the call site), so this also pins that the hand-written version is still a
  // real labelled checkbox wired to `setPref`.
  it("offers the P3.3 dash/marker switch beside the palette, off by default, and writes the pref", () => {
    render(<AppearanceMenu />);
    open();
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

  it("still shows the accent/density controls", () => {
    render(<AppearanceMenu />);
    open();
    expect(screen.getByText("Accent")).toBeInTheDocument();
    expect(screen.getByText("Density")).toBeInTheDocument();
  });

  it('hides the "All preferences…" footer (PreferencesDialog is not mounted there)', () => {
    render(<AppearanceMenu />);
    open();
    expect(screen.queryByText("All preferences…")).not.toBeInTheDocument();
  });
});
