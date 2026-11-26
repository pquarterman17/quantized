// P2 result reuse: a disabled table action shows its reason and next step
// beside it (a title is hover-only), and nothing extra once it is enabled.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToolTableActions } from "./ToolBookActions";
import { SAVE_FIRST, type ToolResultBook } from "./useToolResultBook";

const book = (blocked: string | null) => ({
  busy: false, saved: null,
  copyBlocked: () => null, reportBlocked: () => blocked, openBlocked: () => blocked,
  copySource: () => "live", copy: () => undefined, report: () => undefined, openTable: () => undefined,
}) as unknown as ToolResultBook;

describe("ToolTableActions reasons", () => {
  it("shows the save-first reason and next action beside the disabled buttons", () => {
    render(<ToolTableActions book={book(SAVE_FIRST)} title="Rows" />);
    expect(screen.getByRole("button", { name: "Open as worksheet: Rows" })).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent("Save the result first");
  });
  it("shows no note when the actions are available", () => {
    render(<ToolTableActions book={book(null)} title="Rows" />);
    expect(screen.queryByRole("note")).toBeNull();
  });
});
