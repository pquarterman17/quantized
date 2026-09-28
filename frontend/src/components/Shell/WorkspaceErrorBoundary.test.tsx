import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useApp } from "../../store/useApp";
import WorkspaceErrorBoundary from "./WorkspaceErrorBoundary";

function Broken(): never {
  throw new Error("workspace exploded");
}

describe("WorkspaceErrorBoundary", () => {
  it("contains a workspace render failure and leaves surrounding chrome mounted", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <div>
        <nav>File Edit Help</nav>
        <WorkspaceErrorBoundary resetKey="one"><Broken /></WorkspaceErrorBoundary>
      </div>,
    );
    expect(screen.getByText("File Edit Help")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("workspace view hit a problem");
    expect(screen.getByRole("button", { name: "Retry workspace view" })).toBeInTheDocument();
    log.mockRestore();
  });

  it("keeps Ctrl+Z undo working while the failure replaces the workspace", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    useApp.setState({ datasets: [], history: [], future: [] });
    useApp.getState().recordHistory("rename dataset");
    const undo = vi.spyOn(useApp.getState(), "undo");
    render(<WorkspaceErrorBoundary resetKey="broken"><Broken /></WorkspaceErrorBoundary>);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    expect(undo).toHaveBeenCalledOnce();
    undo.mockRestore();
    log.mockRestore();
  });

  it("recovers automatically when the workspace identity changes", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <WorkspaceErrorBoundary resetKey="broken"><Broken /></WorkspaceErrorBoundary>,
    );
    rerender(
      <WorkspaceErrorBoundary resetKey="empty"><div>Empty project is usable</div></WorkspaceErrorBoundary>,
    );
    expect(screen.getByText("Empty project is usable")).toBeInTheDocument();
    log.mockRestore();
  });
});
