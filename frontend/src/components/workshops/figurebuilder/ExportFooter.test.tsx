import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ExportFooter from "./ExportFooter";

const props = {
  fmt: "pdf", onExport: vi.fn(), exportDisabledReason: null, canonical: true, detached: false, dirty: false,
  canApply: true, applyBlockedReason: null, onApply: vi.fn(), onClose: vi.fn(),
};

describe("ExportFooter revision", () => {
  it("shows which revision Export will write, beside the button", () => {
    render(<ExportFooter {...props} revision="a1b2c3d4" />);
    expect(screen.getByText("Revision a1b2c3d4")).toBeInTheDocument();
    expect(screen.getByText("Revision a1b2c3d4")).toHaveAttribute("title", expect.stringMatching(/writes exactly this revision/i));
  });
  it("shows nothing for a legacy preview that has no figure document", () => {
    render(<ExportFooter {...props} canonical={false} revision={null} />);
    expect(screen.queryByText(/^Revision /)).toBeNull();
  });
});
