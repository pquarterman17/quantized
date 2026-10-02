// A toast's action button unmounts with its toast. Focus on it used to fall to
// <body>, where the global Delete binding removes the active dataset. It must
// go back where it came from, or to a safe spot that absorbs a stray Delete.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Toaster from "./Toaster";
import { useToasts } from "../../store/toasts";

function pushAction(onClick: () => void = () => {}): void {
  act(() => useToasts.getState().push("overlay?", "ok", { action: { label: "Overlay", onClick } }));
}

beforeEach(() => {
  useToasts.setState({ toasts: [] });
});

describe("Toaster action focus", () => {
  it("returns focus to the element that had it before the toast took it", () => {
    render(
      <>
        <button type="button">Elsewhere</button>
        <Toaster />
      </>,
    );
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    elsewhere.focus();
    pushAction();
    const action = screen.getByRole("button", { name: "Overlay" });
    act(() => action.focus());
    fireEvent.click(action);
    expect(useToasts.getState().toasts).toHaveLength(0);
    expect(elsewhere).toHaveFocus();
  });

  it("with no previous focus, lands on a safe spot (never <body>) that absorbs Delete", () => {
    const { container } = render(<Toaster />);
    pushAction();
    const action = screen.getByRole("button", { name: "Overlay" });
    act(() => action.focus());
    fireEvent.click(action);
    expect(useToasts.getState().toasts).toHaveLength(0);
    expect(document.body).not.toHaveFocus();
    expect(container.querySelector(".qzk-toaster")).toHaveFocus();
    // fireEvent returns false when a handler called preventDefault().
    expect(fireEvent.keyDown(document.activeElement!, { key: "Delete" })).toBe(false);
  });

  it("leaves focus alone when the action itself moved it", () => {
    render(
      <>
        <button type="button">Elsewhere</button>
        <input aria-label="Target" />
        <Toaster />
      </>,
    );
    screen.getByRole("button", { name: "Elsewhere" }).focus();
    const onClick = vi.fn(() => screen.getByLabelText("Target").focus());
    pushAction(onClick);
    const action = screen.getByRole("button", { name: "Overlay" });
    act(() => action.focus());
    fireEvent.click(action);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Target")).toHaveFocus();
  });
});
