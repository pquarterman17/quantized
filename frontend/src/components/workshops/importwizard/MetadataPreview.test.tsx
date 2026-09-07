import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ImportPreviewResponse } from "../../../lib/types";
import MetadataPreview from "./MetadataPreview";

const preview = {
  raw_lines: [], n_lines: 0, delimiter: ",", header_line: null, units_line: null,
  label_line: null, data_start_line: 0, columns: [], rows: [], n_data_rows: 0,
  n_preview_rows: 0, comments: ["instrument note"],
  header_fields: { Sample: "A17", Temperature: "300 K" },
  header_field_problems: [{ type: "duplicate_header_field", key: "Sample" }],
} satisfies ImportPreviewResponse;

describe("MetadataPreview", () => {
  it("shows structured fields, retained text, and duplicate-key resolution", () => {
    render(<MetadataPreview preview={preview} />);
    expect(screen.getByText("A17")).toBeInTheDocument();
    expect(screen.getByText("300 K")).toBeInTheDocument();
    expect(screen.getByText(/Repeated metadata key: Sample/)).toBeInTheDocument();
    expect(screen.getByText(/instrument note/)).toBeInTheDocument();
  });

  it("renders nothing when the preview contains no metadata", () => {
    const { container } = render(<MetadataPreview preview={{ ...preview, comments: [], header_fields: {}, header_field_problems: [] }} />);
    expect(container.firstChild).toBeNull();
  });
});
