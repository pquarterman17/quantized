import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CategoricalProblems from "./CategoricalProblems";

describe("CategoricalProblems", () => {
  it("blocks a large categorical column until explicitly accepted", () => {
    const allow = vi.fn();
    render(<CategoricalProblems problems={[{ type: "categorical_level_cap", column: "Sample", level_count: 1250, cap: 1000 }]} allowLarge={false} onAllowLarge={allow} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Sample has 1250 distinct values");
    fireEvent.click(screen.getByRole("button", { name: "Import large category anyway" }));
    expect(allow).toHaveBeenCalledOnce();
  });

  it("explains capitalization collisions without blocking", () => {
    render(<CategoricalProblems problems={[{ type: "categorical_case_collision", column: "Lot", labels: ["A", "a"] }]} allowLarge={false} onAllowLarge={vi.fn()} />);
    expect(screen.getByText(/Lot contains labels differing only by capitalization: A, a/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
