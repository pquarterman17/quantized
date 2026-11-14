// Re-audit #15: the Export dialog's Width / Height start blank on a window
// with no page (blank = the style preset's size) but gave no hint of what
// that size is. A blank field now shows the size it exports at.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ParamFieldRow } from "../components/overlays/ParamFields";
import { pageSizeFields } from "./pageSizeFields";

describe("blank page-size fields show the size a blank exports at (re-audit #15)", () => {
  it("Width / Height show 6 and 4 (the Default preset, in inches) and stay blank", () => {
    const fields = pageSizeFields(null);
    for (const [key, size] of [["width", "6"], ["height", "4"]] as const) {
      const f = fields.find((x) => x.key === key)!;
      const { unmount } = render(<ParamFieldRow field={f} value={f.default as string} onChange={vi.fn()} />);
      const box = screen.getByRole("textbox");
      expect(box).toHaveValue("");
      expect(box).toHaveAttribute("placeholder", size);
      unmount();
    }
    expect(fields[0].hint).toContain("6 × 4 in");
  });

  it("a window with a page shows its own size, no placeholder", () => {
    const fields = pageSizeFields({ width: 3.4, height: 2.6, unit: "in", margins: { top: 0, right: 0, bottom: 0, left: 0 }, aspectDerived: false } as never);
    expect(fields[0].default).toBe(3.4);
    expect(fields[0].placeholder).toBeUndefined();
  });
});
