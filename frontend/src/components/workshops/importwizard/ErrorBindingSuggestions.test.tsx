import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ErrorBindingSuggestions from "./ErrorBindingSuggestions";

const columns = [
  { index: 0, name: "Field", unit: "T", role: "x" as const },
  { index: 1, name: "Moment", unit: "emu", role: "y" as const },
  { index: 2, name: "dMoment", unit: "emu", role: "y" as const },
];

describe("ErrorBindingSuggestions", () => {
  it("explains a backend suggestion and only applies it on request", () => {
    const onApply = vi.fn();
    const suggestion = { column: 2, target: 1, axis: "y" as const, side: "both" as const };
    render(<ErrorBindingSuggestions columns={columns} suggestions={[suggestion]} problems={[]} onApply={onApply} />);

    expect(screen.getByText(/Use/).parentElement).toHaveTextContent("Use dMoment as y-error for Moment");
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply suggestion" }));
    expect(onApply).toHaveBeenCalledWith(suggestion);
  });

  it("shows why a saved binding was rejected", () => {
    render(<ErrorBindingSuggestions columns={columns} suggestions={[]} problems={[{
      column: 8,
      target: 1,
      axis: "y",
      side: "both",
      code: "column_out_of_range",
      reason: "Error column 9 no longer exists in this file.",
    }]} onApply={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Saved error settings need attention");
    expect(screen.getByRole("alert")).toHaveTextContent("Error column 9 no longer exists");
  });
});
