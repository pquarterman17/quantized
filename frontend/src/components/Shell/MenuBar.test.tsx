import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MenuBar from "./MenuBar";
import { useCommands, type Action } from "../../store/commands";

const actions: Action[] = [
  { id: "imp", group: "File", label: "Import data…", run: vi.fn() },
  { id: "pal", group: "Edit", label: "Command palette…", run: vi.fn() },
  { id: "merge", group: "Data", label: "Merge selected datasets", run: vi.fn() },
  { id: "auto", group: "Plot", label: "Autoscale / reset view", run: vi.fn() },
  { id: "fit", group: "Analyze", label: "Curve fit…", run: vi.fn() },
  { id: "thm", group: "View", label: "Toggle theme", run: vi.fn() },
];

beforeEach(() => useCommands.setState({ menuCommands: [] }));
afterEach(() => useCommands.setState({ menuCommands: [] }));

describe("MenuBar", () => {
  it("renders the eight-menu structure (File·Edit·Data·Plot·Analyze·Window·View + Help)", () => {
    render(<MenuBar actions={actions} onOpenPalette={vi.fn()} />);
    for (const m of ["File", "Edit", "Data", "Plot", "Analyze", "Window", "View", "Help"]) {
      expect(screen.getByText(m)).toBeInTheDocument();
    }
  });

  it("merges published command-registry entries (e.g. Window commands) into the matching menu", () => {
    useCommands.setState({
      menuCommands: [{ id: "window-new", group: "Window", label: "New Graph Window", run: vi.fn() }],
    });
    render(<MenuBar actions={actions} onOpenPalette={vi.fn()} />);
    fireEvent.click(screen.getByText("Window"));
    expect(screen.getByText("New Graph Window")).toBeInTheDocument();
  });

  it("opens a menu and runs an item, scoped to that group", () => {
    render(<MenuBar actions={actions} onOpenPalette={vi.fn()} />);
    fireEvent.click(screen.getByText("Plot"));
    expect(screen.getByText("Autoscale / reset view")).toBeInTheDocument();
    // Plot's popup shows only Plot items, not Data's.
    expect(screen.queryByText("Merge selected datasets")).toBeNull();

    fireEvent.click(screen.getByText("Data"));
    fireEvent.click(screen.getByText("Merge selected datasets"));
    expect((actions[2].run as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });

  it("the Help menu offers the command palette", () => {
    const onOpenPalette = vi.fn();
    render(<MenuBar actions={actions} onOpenPalette={onOpenPalette} />);
    fireEvent.click(screen.getByText("Help"));
    fireEvent.click(screen.getByText("Command palette"));
    expect(onOpenPalette).toHaveBeenCalledOnce();
  });
});
