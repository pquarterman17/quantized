import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";

import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
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

it("steps aside once data is loaded, unless reopened explicitly", () => {
  // Plot audit round 2: the first-run card sat over the plot's right edge
  // (tick labels, legend) after the first import. It is an empty-workspace
  // hint; Help ▸ Show interaction hints still brings it back over a plot.
  render(<InteractionHints />);
  expect(screen.getByLabelText("Interaction hints")).toBeInTheDocument();
  const ds: Dataset = {
    id: "d1",
    name: "d1.csv",
    data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} },
  };
  act(() => useApp.getState().loadWorkspace({ datasets: [ds], activeId: "d1" }));
  expect(screen.queryByLabelText("Interaction hints")).toBeNull();
  act(() => showInteractionHints());
  expect(screen.getByLabelText("Interaction hints")).toBeInTheDocument();
  act(() => useApp.getState().loadWorkspace({ datasets: [], activeId: null }));
});
