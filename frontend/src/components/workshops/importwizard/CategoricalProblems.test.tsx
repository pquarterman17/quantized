import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ImportCategoricalProblem } from "../../../lib/types";
import CategoricalProblems from "./CategoricalProblems";

const cap = (index: number, column: string, levels = 1250): ImportCategoricalProblem => ({
  type: "categorical_level_cap", index, column, level_count: levels, cap: 1000,
});

describe("CategoricalProblems", () => {
  it("blocks a large categorical column until explicitly accepted", () => {
    const accept = vi.fn();
    render(<CategoricalProblems problems={[cap(2, "Sample")]} accepted={[]} onAccept={accept} onUnaccept={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Sample has 1250 distinct values");
    fireEvent.click(screen.getByRole("button", { name: "Import Sample as a large category anyway" }));
    expect(accept).toHaveBeenCalledWith(2);
  });

  it("accepts ONE column without accepting another that also blew the cap", () => {
    // Review finding #1: the decision is per column. `Sample` accepted must
    // leave `Garbage` — the column the cap actually exists to catch — still
    // blocking, with its own button.
    const accept = vi.fn();
    render(
      <CategoricalProblems
        problems={[cap(2, "Sample"), cap(5, "Garbage", 200000)]}
        accepted={[2]}
        onAccept={accept}
        onUnaccept={vi.fn()}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Import is paused");
    expect(screen.getByRole("button", { name: "Import Garbage as a large category anyway" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import Sample as a large category anyway" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Import Garbage as a large category anyway" }));
    expect(accept).toHaveBeenCalledWith(5);
  });

  it("stops warning once every flagged column is accepted, and can be undone", () => {
    const unaccept = vi.fn();
    render(
      <CategoricalProblems
        problems={[cap(2, "Sample")]}
        accepted={[2]}
        onAccept={vi.fn()}
        onUnaccept={unaccept}
      />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Accepted for this import.");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(unaccept).toHaveBeenCalledWith(2);
  });

  it("keys rows on the column INDEX, so two columns sharing a header both render", () => {
    // `_resolve_names` never de-duplicates names, so keying on `column` made
    // React reconcile the two warnings as one — merged or stale (finding #4).
    render(
      <CategoricalProblems
        problems={[cap(1, "Tag", 900), cap(2, "Tag", 1500)]}
        accepted={[]}
        onAccept={vi.fn()}
        onUnaccept={vi.fn()}
      />,
    );
    expect(screen.getByText(/Tag has 900 distinct values/)).toBeInTheDocument();
    expect(screen.getByText(/Tag has 1500 distinct values/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Import Tag as a large category anyway" })).toHaveLength(2);
  });

  it("explains capitalization collisions without blocking", () => {
    render(
      <CategoricalProblems
        problems={[{ type: "categorical_case_collision", index: 3, column: "Lot", labels: ["A", "a"] }]}
        accepted={[]}
        onAccept={vi.fn()}
        onUnaccept={vi.fn()}
      />,
    );
    expect(screen.getByText(/Lot contains labels differing only by capitalization: A, a/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
