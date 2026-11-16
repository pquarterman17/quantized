// UX-D: the empty stage offers the four primary start actions with their
// shortcuts, and its CSS actually centres it (the bare .qzk-empty-project rule
// lost to .qzk-stage-cell's display:flex and the card sat at the top).

import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import EmptyProjectStage from "./EmptyProjectStage";
import { useApp } from "../../store/useApp";

describe("EmptyProjectStage", () => {
  it("shows Import / Paste / Open project / Demo with shortcuts", () => {
    render(<EmptyProjectStage />);
    for (const name of [/Import data/, /Paste from clipboard/, /Open project/, /Demo dataset/]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /Import data/ })).toHaveTextContent(/(Ctrl|⌘)O/);
    expect(screen.getByRole("button", { name: /Paste from clipboard/ })).toHaveTextContent(/(Ctrl|⌘)V/);
  });

  it("loads a demo dataset in one click", () => {
    useApp.setState({ datasets: [] });
    render(<EmptyProjectStage />);
    fireEvent.click(screen.getByRole("button", { name: /Demo dataset/ }));
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("styles the card with a selector that outranks .qzk-stage-cell", () => {
    const css = readFileSync("src/styles/shell.css", "utf8");
    expect(css).toMatch(/\.qzk-empty-project\.qzk-stage-cell[^{]*\{[^}]*display:\s*grid[^}]*place-items:\s*center/);
  });
});
