// P3.1 — contextual `?` help at the WORKSHOP level.
//
// The shipped slice put `?` actions on Inspector cards via `Card`'s
// `helpTopic`. Extending that to workshops could not use the same prop:
// measured on this tree, 59 of the 64 `<Card>`s inside `components/workshops`
// are single-formula DiraCulator cards (a `?` on each would be exactly the
// clutter P3.1's goal warns against), and the complex workshops mostly render
// no `Card` at all. What they DO all share is `ToolWindow` — the floating
// panel chrome, already keyed by a stable per-workshop id — so the affordance
// belongs in its title bar.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { openHelpTopic } from "../../store/help";
import { useApp } from "../../store/useApp";
import ToolWindow from "./ToolWindow";

vi.mock("../../store/help", () => ({ openHelpTopic: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ toolWindowLayout: {} });
});

describe("ToolWindow contextual help", () => {
  it("falls back to the window title when the panel declares no topic (UX10 P2-1: every tool window has a ?)", () => {
    render(
      <ToolWindow id="t1" title="Peaks">
        <div>body</div>
      </ToolWindow>,
    );
    const help = screen.getByRole("button", { name: "Help for Peaks" });
    fireEvent.click(help);
    expect(openHelpTopic).toHaveBeenCalledWith("Peaks");
  });

  it("opens Help filtered to the panel's topic", () => {
    render(
      <ToolWindow id="t2" title="Peaks" helpTopic="Find peaks">
        <div>body</div>
      </ToolWindow>,
    );
    const help = screen.getByRole("button", { name: "Help for Peaks" });
    fireEvent.click(help);
    expect(openHelpTopic).toHaveBeenCalledWith("Find peaks");
  });

  it("the Signal Processing window gets its Help button from the workshop registry (A1 contextual Help)", () => {
    render(
      <ToolWindow id="signal-processing" title="Signal Processing">
        <div>body</div>
      </ToolWindow>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Help for Signal Processing" }));
    expect(openHelpTopic).toHaveBeenCalledWith("Signal Processing");
  });

  // NOT TESTED HERE, deliberately: that pressing `?` must not start a window
  // drag. The title bar is the drag handle, so the button stops pointerdown
  // exactly as Close and Collapse do — but jsdom cannot verify it. Measured:
  // with the guard REMOVED, `fireEvent.pointerDown` on the button still
  // produces zero `setPointerCapture` calls and zero layout change, because
  // jsdom does not propagate React's synthetic pointer events from the child
  // to the parent handler. Three different assertions (layout unchanged,
  // setPointerCapture uncalled, a native-listener spy) all stayed green with
  // the guard deleted, so each would have been a false green rather than a
  // regression guard. Real pointer semantics live in the Playwright e2e suite;
  // that is where this belongs if it is ever worth pinning.
});
