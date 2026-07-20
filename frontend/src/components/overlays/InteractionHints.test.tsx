import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";

import InteractionHints, { showInteractionHints } from "./InteractionHints";

beforeEach(() => localStorage.removeItem("qz.interactionHints.seen"));
afterEach(() => localStorage.removeItem("qz.interactionHints.seen"));

it("shows once, dismisses persistently, and can be reopened explicitly", () => {
  const { unmount } = render(<InteractionHints />);
  expect(screen.getByLabelText("Interaction hints")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Got it" }));
  expect(screen.queryByLabelText("Interaction hints")).toBeNull();

  unmount();
  render(<InteractionHints />);
  expect(screen.queryByLabelText("Interaction hints")).toBeNull();
  act(() => showInteractionHints());
  expect(screen.getByLabelText("Interaction hints")).toBeInTheDocument();
});

it("does not block interaction with the elements it overlaps", () => {
  // Regression: this first-run card sits over the lower-right Inspector and,
  // shown by default, swallowed clicks (10 e2e tests). It must be
  // pointer-events:none, with only its dismiss button interactive.
  render(<InteractionHints />);
  const card = screen.getByLabelText("Interaction hints");
  expect(card.style.pointerEvents).toBe("none");
  expect(screen.getByRole("button", { name: "Got it" }).style.pointerEvents).toBe("auto");
});
