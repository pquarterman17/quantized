import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ImportPreviewResponse } from "../../../lib/types";
import MetadataPreview from "./MetadataPreview";

// The fixture is built the way the BACKEND builds its response: `comments` is
// the retained preamble, `header_fields` is a parse of THOSE SAME lines, and
// `unparsed_comments` is what that parse left over. Pinning an arbitrary
// `header_fields` next to unrelated `comments` describes a payload
// `preview_import` cannot produce, and hid the duplicate rendering this
// component used to do.
const COMMENTS = [
  "instrument note",
  "Sample: A17",
  "Temperature: 300 K",
  "Sample: B02",
];

const preview = {
  raw_lines: [], n_lines: 0, delimiter: ",", header_line: null, units_line: null,
  label_line: null, data_start_line: 0, columns: [], rows: [], n_data_rows: 0,
  n_preview_rows: 0,
  comments: COMMENTS,
  header_fields: { Sample: "B02", Temperature: "300 K" },
  header_field_problems: [{ type: "duplicate_header_field", key: "Sample" }],
  unparsed_comments: ["instrument note"],
} satisfies ImportPreviewResponse;

describe("MetadataPreview", () => {
  it("shows structured fields, retained text, and duplicate-key resolution", () => {
    render(<MetadataPreview preview={preview} />);
    expect(screen.getByText("B02")).toBeInTheDocument();
    expect(screen.getByText("300 K")).toBeInTheDocument();
    expect(screen.getByText(/Repeated metadata key: Sample/)).toBeInTheDocument();
    expect(screen.getByText(/instrument note/)).toBeInTheDocument();
  });

  it("does not render a `key: value` line a second time as leftover prose", () => {
    render(<MetadataPreview preview={preview} />);
    const leftover = screen.getByText(/retained as searchable metadata/);
    expect(leftover.textContent).toContain("instrument note");
    expect(leftover.textContent).not.toContain("Temperature: 300 K");
    expect(leftover.textContent).not.toContain("Sample: A17");
  });

  it("falls back to the full comment list when the response predates unparsed_comments", () => {
    const { unparsed_comments: _omitted, ...older } = preview;
    render(<MetadataPreview preview={older} />);
    // Duplicated, but nothing retained is hidden — the old behaviour.
    expect(screen.getByText(/retained as searchable metadata/).textContent)
      .toContain("Temperature: 300 K");
  });

  it("renders nothing when the preview contains no metadata", () => {
    const { container } = render(<MetadataPreview preview={{
      ...preview, comments: [], unparsed_comments: [], header_fields: {}, header_field_problems: [],
    }} />);
    expect(container.firstChild).toBeNull();
  });
});
