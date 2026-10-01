// UX-001 (plans/BUGS_AND_ISSUES.md): the Library TREE's worksheet rows used
// to render as a large always-expanded card (name row + an always-mounted
// Sparkline + a meta/actions footer + a tag row) while saved-graph rows
// (FigureRow) were a single compact line — inconsistent and space-hungry.
// This locks the fix's DOM shape for `treeMode` (LibraryTree.tsx's only
// caller): one line, no Sparkline mounted until a user explicitly asks for
// it, and asking for it never touches selection or the active plot.
//
// Sabotage-verified against the pre-fix DatasetRow (the always-mounted
// `<Sparkline data={d.data} />` inside the `treeMode` branch, no toggle) —
// every test below was confirmed to fail there before this file was written
// against the fixed component; see the PR/commit note.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import DatasetRow from "./DatasetRow";

const ds: Dataset = {
  id: "d1",
  name: "sample.dat",
  data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["A"], units: ["Oe"], metadata: {} },
};

const baseProps = {
  active: false,
  selected: false,
  showReorder: false,
  canMoveUp: false,
  canMoveDown: false,
  onFilterTag: () => {},
};

beforeEach(() => {
  useApp.setState({ datasets: [ds], activeId: null, selectedIds: [] });
  localStorage.removeItem("qz.libraryTreePreviewIds");
});

describe("DatasetRow — Tree (treeMode) compact worksheet row (UX-001)", () => {
  it("renders as a single-line row: no Sparkline mounted on first render", () => {
    const { container } = render(<DatasetRow dataset={ds} {...baseProps} treeMode />);
    expect(container.querySelector(".qzk-ds")).toHaveClass("qzk-ds-compact");
    expect(container.querySelector(".qzk-ds-spark")).not.toBeInTheDocument();
    // The footer card's always-visible actions strip (▲▼⧉✕) is gone from the
    // compact row — reachable through the "⋯"/context menu instead
    // (datasetRowMenu.ts), not duplicated as a second UI.
    expect(container.querySelector(".qzk-ds-foot")).not.toBeInTheDocument();
    // Tags, however, STAY. This assertion used to require `.qzk-ds-tags` to be
    // absent, which is what let the regression below ship: with no tag row
    // rendered in tree mode, "Add tag…" was a dead no-op and existing chips
    // were unreachable. The row stays visually compact because the tag
    // container takes no height until it has something in it (shell.css's
    // `.qzk-ds-tags-compact` is a full-width flex child that wraps).
    expect(container.querySelector(".qzk-ds-tags")).toBeInTheDocument();
  });

  // REVIEW ROUND regression guard. Compactness must not cost function: the
  // context menu's "Add tag…" sets the row's tag-input state, and before the
  // fix no input rendered in tree mode to receive it, so the menu item did
  // nothing at all.
  it("keeps tagging usable in tree mode: existing chips render and Add tag opens an input", () => {
    const tagged: Dataset = { ...ds, tags: ["anneal"] };
    const { container } = render(<DatasetRow dataset={tagged} {...baseProps} treeMode />);
    // An existing tag is visible (and so is its remove control).
    expect(screen.getByText("anneal")).toBeInTheDocument();
    expect(screen.getByTitle("Remove tag")).toBeInTheDocument();
    // The add affordance actually produces an input rather than nothing.
    fireEvent.click(screen.getByTitle("Add tag"));
    expect(container.querySelector(".qzk-tag-input")).toBeInTheDocument();
  });

  it("carries an explicit, tooltipped Worksheet type glyph", () => {
    const { container } = render(<DatasetRow dataset={ds} {...baseProps} treeMode />);
    expect(screen.getByTitle("Worksheet")).toBeInTheDocument();
    expect(container.querySelector(".qzk-origin-kind")).toBeNull();
  });

  it("only shortens an untouched importer-generated Origin name in Tree view", () => {
    const origin: Dataset = {
      ...ds,
      name: "Moke:Book4 — 30 nm MnN",
      data: { ...ds.data, metadata: { origin_book: "Book4", origin_book_long: "30 nm MnN" } },
      source: { kind: "path", path: "C:\\data\\Moke.opju" },
    };
    const first = render(<DatasetRow dataset={origin} {...baseProps} treeMode />);
    expect(first.container.querySelector(".qzk-ds-name")).toHaveTextContent("Book4 — 30 nm MnN");
    expect(first.container.querySelector(".qzk-ds-name")).not.toHaveTextContent("Moke:");
    expect(first.container.querySelector(".qzk-ds-name")).toHaveAttribute(
      "title",
      "Moke:Book4 — 30 nm MnN — double-click to rename",
    );
    first.unmount();

    const renamed = { ...origin, name: "My review copy" };
    const second = render(<DatasetRow dataset={renamed} {...baseProps} treeMode />);
    expect(screen.getByText("My review copy")).toBeInTheDocument();
    second.unmount();

    const sourceLess = { ...origin, source: undefined };
    const third = render(<DatasetRow dataset={sourceLess} {...baseProps} treeMode />);
    expect(screen.getByText("Moke:Book4 — 30 nm MnN")).toBeInTheDocument();
    third.unmount();

    render(<DatasetRow dataset={origin} {...baseProps} />);
    expect(screen.getByText("Moke:Book4 — 30 nm MnN")).toBeInTheDocument();
  });

  it("keeps the FULL name as the accessible name when Tree view shortens the visible label", () => {
    // The visible text and the accessible name must not silently diverge: a
    // screen reader reading the shortened `.qzk-ds-name` span's content would
    // otherwise announce "Book4 — 30 nm MnN" and drop the file-stem context
    // that a sighted user still gets from the tooltip. `aria-label` must
    // carry the untruncated name whenever the display text is shortened, and
    // must be absent (not merely redundant) for an ordinary, unshortened row.
    const origin: Dataset = {
      ...ds,
      name: "Moke:Book4 — 30 nm MnN",
      data: { ...ds.data, metadata: { origin_book: "Book4", origin_book_long: "30 nm MnN" } },
      source: { kind: "path", path: "C:\\data\\Moke.opju" },
    };
    const shortened = render(<DatasetRow dataset={origin} {...baseProps} treeMode />);
    expect(shortened.container.querySelector(".qzk-ds-name")).toHaveAttribute(
      "aria-label",
      "Moke:Book4 — 30 nm MnN",
    );
    shortened.unmount();

    const unshortened = render(<DatasetRow dataset={ds} {...baseProps} treeMode />);
    expect(unshortened.container.querySelector(".qzk-ds-name")).not.toHaveAttribute("aria-label");
  });

  it("double-clicking a shortened row's name still opens the rename input pre-filled with the FULL name", () => {
    const origin: Dataset = {
      ...ds,
      name: "Moke:Book4 — 30 nm MnN",
      data: { ...ds.data, metadata: { origin_book: "Book4", origin_book_long: "30 nm MnN" } },
      source: { kind: "path", path: "C:\\data\\Moke.opju" },
    };
    render(<DatasetRow dataset={origin} {...baseProps} treeMode />);
    const name = screen.getByText("Book4 — 30 nm MnN");
    fireEvent.doubleClick(name);
    expect(screen.getByDisplayValue("Moke:Book4 — 30 nm MnN")).toBeInTheDocument();
    // Named for what it renames, not left unnamed.
    expect(screen.getByRole("textbox", { name: 'Rename "Moke:Book4 — 30 nm MnN"' })).toBeInTheDocument();
  });

  it("shows concise rows/channels meta text on the one line", () => {
    render(<DatasetRow dataset={ds} {...baseProps} treeMode />);
    expect(screen.getByText("3 pts · 1 ch")).toBeInTheDocument();
  });

  it("the preview toggle mounts the Sparkline on demand, without selecting the row or touching activeId", () => {
    const { container } = render(<DatasetRow dataset={ds} {...baseProps} treeMode />);
    const toggle = screen.getByRole("button", { name: "Show preview" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(container.querySelector(".qzk-ds-spark")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide preview" })).toHaveAttribute("aria-pressed", "true");
    // Expanding a preview is not a selection or open gesture (LIBRARY_
    // WORKBOOK_UX_PLAN interaction checklist): selection and the active plot
    // are exactly as they started.
    expect(useApp.getState().selectedIds).toEqual([]);
    expect(useApp.getState().activeId).toBeNull();
  });

  it("toggling again collapses it", () => {
    const { container } = render(<DatasetRow dataset={ds} {...baseProps} treeMode />);
    fireEvent.click(screen.getByRole("button", { name: "Show preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide preview" }));
    expect(container.querySelector(".qzk-ds-spark")).not.toBeInTheDocument();
  });

  it("persists the expanded state across remounts (per-row, localStorage-backed)", () => {
    const first = render(<DatasetRow dataset={ds} {...baseProps} treeMode />);
    fireEvent.click(first.getByRole("button", { name: "Show preview" }));
    first.unmount();
    const second = render(<DatasetRow dataset={ds} {...baseProps} treeMode />);
    expect(second.container.querySelector(".qzk-ds-spark")).toBeInTheDocument();
    expect(second.getByRole("button", { name: "Hide preview" })).toBeInTheDocument();
  });
});

describe("DatasetRow — flat/full card (treeMode=false) is unchanged by UX-001", () => {
  it("still always mounts the Sparkline — only the Tree row became opt-in", () => {
    const { container } = render(<DatasetRow dataset={ds} {...baseProps} />);
    expect(container.querySelector(".qzk-ds")).not.toHaveClass("qzk-ds-compact");
    expect(container.querySelector(".qzk-ds-spark")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /preview/i })).not.toBeInTheDocument();
  });
});
