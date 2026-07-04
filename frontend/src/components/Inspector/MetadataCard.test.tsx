import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import MetadataCard from "./MetadataCard";
import type { Dataset } from "../../lib/types";

const ds = (metadata: Record<string, unknown>): Dataset => ({
  id: "d1",
  name: "t.opj",
  data: { time: [1], values: [[2]], labels: ["A"], units: [""], metadata },
});

describe("MetadataCard", () => {
  it("renders key/value rows for import metadata", () => {
    render(<MetadataCard active={ds({ origin_book: "Book4", sample: "MnN 30nm" })} />);
    expect(screen.getByText("origin_book")).toBeInTheDocument();
    expect(screen.getByText("Book4")).toBeInTheDocument();
    expect(screen.getByText("MnN 30nm")).toBeInTheDocument();
  });

  it("truncates long values for display (full text stays in the tooltip contract)", () => {
    const log = "x".repeat(1000);
    render(<MetadataCard active={ds({ origin_results_log: log })} />);
    const cell = screen.getByText(/^x+…$/);
    expect(cell.textContent!.length).toBeLessThan(300);
  });

  it("renders nothing without metadata", () => {
    const { container } = render(<MetadataCard active={ds({})} />);
    expect(container.firstChild).toBeNull();
  });

  it("hides the internal x-column wiring keys", () => {
    render(<MetadataCard active={ds({ x_column_name: "H", other: "v" })} />);
    expect(screen.queryByText("x_column_name")).toBeNull();
    expect(screen.getByText("other")).toBeInTheDocument();
  });
});
