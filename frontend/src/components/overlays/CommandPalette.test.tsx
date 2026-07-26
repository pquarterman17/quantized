import { fireEvent, render, screen } from "@testing-library/react";
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
