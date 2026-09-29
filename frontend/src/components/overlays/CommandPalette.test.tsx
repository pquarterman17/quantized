import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CommandPalette from "./CommandPalette";
import { useApp } from "../../store/useApp";

const action = {
  id: "break-x-axis",
  group: "Plot",
  label: "Break x-axis at gaps…",
  description: "Detect large gaps and display a discontinuous horizontal axis.",
  run: vi.fn(),
};

beforeEach(() => {
  useApp.setState({ cmdkOpen: true });
});

afterEach(() => {
  useApp.setState({ cmdkOpen: false });
  vi.clearAllMocks();
});

// Residual R2 (PRIMARY_SOFTWARE_AUDIT_PLAN): the palette focused its input and
// never gave focus back, so every close left the user on <body>, where the
// global Delete binding removes the active dataset.
describe("CommandPalette returns focus to its opener (R2)", () => {
  async function openFrom(actions = [action]): Promise<HTMLElement> {
    useApp.setState({ cmdkOpen: false });
    render(
      <>
        <button type="button">Opener</button>
        <CommandPalette actions={actions} />
      </>,
    );
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    act(() => useApp.setState({ cmdkOpen: true }));
    const input = screen.getByPlaceholderText("Type a command…");
    await waitFor(() => expect(input).toHaveFocus());
    return opener;
  }

  it("on Escape", async () => {
    const opener = await openFrom();
    fireEvent.keyDown(screen.getByPlaceholderText("Type a command…"), { key: "Escape" });
    expect(useApp.getState().cmdkOpen).toBe(false);
    expect(opener).toHaveFocus();
  });

  it("on running a command, BEFORE the command acts", async () => {
    // Before, not after: a command that opens a dialog must see the real
    // opener as the focused element, or that dialog restores to a dead input.
    let focusedAtRun: Element | null = null;
    const probe = { ...action, run: vi.fn(() => (focusedAtRun = document.activeElement)) };
    const opener = await openFrom([probe]);
    fireEvent.keyDown(screen.getByPlaceholderText("Type a command…"), { key: "Enter" });
    expect(probe.run).toHaveBeenCalledOnce();
    expect(focusedAtRun).toBe(opener);
    expect(opener).toHaveFocus();
  });

  it("on a close from outside the palette (the unmount backstop)", async () => {
    const opener = await openFrom();
    act(() => useApp.setState({ cmdkOpen: false }));
    expect(opener).toHaveFocus();
  });

  it("on a backdrop click", async () => {
    const opener = await openFrom();
    const backdrop = document.querySelector(".qz-overlay-backdrop");
    if (!backdrop) throw new Error("palette backdrop not rendered");
    fireEvent.mouseDown(backdrop);
    expect(useApp.getState().cmdkOpen).toBe(false);
    expect(opener).toHaveFocus();
  });
});

describe("CommandPalette discovery descriptions", () => {
  it("shows the concise command outcome below its label", () => {
    render(<CommandPalette actions={[action]} />);
    expect(screen.getByText(action.description)).toBeInTheDocument();
  });

  it("finds a command by words in its description", () => {
    render(<CommandPalette actions={[action]} />);
    fireEvent.change(screen.getByPlaceholderText("Type a command…"), {
      target: { value: "discontinuous" },
    });
    expect(screen.getByText("Break x-axis at gaps…")).toBeInTheDocument();
    expect(screen.queryByText("No matching commands")).not.toBeInTheDocument();
  });
});
