// UX-D: the empty stage offers the primary start actions, wired to the SAME
// File-menu command bodies (a click really runs them), with shortcuts exposed
// via aria-keyshortcuts rather than inside the accessible names; and its CSS
// actually centres it (the bare .qzk-empty-project rule lost to
// .qzk-stage-cell's display:flex and the card sat at the top).

import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runOpen, runImportEntry } = vi.hoisted(() => ({ runOpen: vi.fn(), runImportEntry: vi.fn() }));
vi.mock("../../lib/openWorkspaceCommand", () => ({ openWorkspaceCommand: () => runOpen }));
vi.mock("../../lib/importEntry", () => ({ runImportEntry }));

import EmptyProjectStage from "./EmptyProjectStage";
import { useApp } from "../../store/useApp";

beforeEach(() => {
  runOpen.mockClear();
  runImportEntry.mockClear();
  useApp.setState({ datasets: [] });
});

describe("EmptyProjectStage", () => {
  it("names the four primary actions like the File menu and keeps shortcuts out of the names", () => {
    render(<EmptyProjectStage />);
    const imp = screen.getByRole("button", { name: "Import data…" });
    expect(imp).toHaveAttribute("aria-keyshortcuts", expect.stringMatching(/^(Control|Meta)\+O$/));
    expect(imp).toHaveTextContent(/(Ctrl\+|⌘)O/); // shown visibly (UX-Q: "Ctrl+O" off macOS)
    expect(screen.getByRole("button", { name: "Paste from clipboard" })).toHaveAttribute("aria-keyshortcuts");
    expect(screen.getByRole("button", { name: "Open workspace (.dwk)…" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add demo dataset" })).toBeInTheDocument();
  });

  it("opens with the drop-or-Open prompt and the shortcut that reaches Import (u1)", () => {
    render(<EmptyProjectStage />);
    expect(screen.getByText(/Drop a data file here, or Open… \((Ctrl\+|⌘)O\)/)).toBeInTheDocument();
  });

  it("Open runs the open-workspace command's body", () => {
    render(<EmptyProjectStage />);
    fireEvent.click(screen.getByRole("button", { name: "Open workspace (.dwk)…" }));
    expect(runOpen).toHaveBeenCalledTimes(1);
  });

  it("Import runs the import command (guard + native-aware chooser)", () => {
    render(<EmptyProjectStage />);
    fireEvent.click(screen.getByRole("button", { name: "Import data…" }));
    expect(runImportEntry).toHaveBeenCalledTimes(1);
  });

  it("Demo adds a dataset through the demo command in one click", () => {
    render(<EmptyProjectStage />);
    fireEvent.click(screen.getByRole("button", { name: "Add demo dataset" }));
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().datasets[0].name).toMatch(/^demo-\d+\.dat$/);
  });

  it("Import wizard opens the wizard", () => {
    useApp.setState({ importWizardOpen: false } as never);
    render(<EmptyProjectStage />);
    fireEvent.click(screen.getByRole("button", { name: "Import wizard…" }));
    expect(useApp.getState().importWizardOpen).toBe(true);
  });

  it("styles the card with a selector that outranks .qzk-stage-cell", () => {
    const css = readFileSync("src/styles/shell.css", "utf8");
    expect(css).toMatch(/\.qzk-empty-project\.qzk-stage-cell[^{]*\{[^}]*display:\s*grid[^}]*place-items:\s*center/);
  });
});
