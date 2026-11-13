// Audit #6 (fonts) / #7: per-element font sizes and a font picker listing what
// the export can render, saying when a chosen font will not render as itself.

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FigureFonts } from "../../../lib/api/figureRenderInfo";
import TypographyPanel, { fontNote, fontOptions } from "./TypographyPanel";

const FONTS: FigureFonts = {
  families: ["DejaVu Sans", "Liberation Sans", "Liberation Serif"],
  aliases: {
    Arial: { family: "Liberation Sans", status: "substituted" },
    "Times New Roman": { family: "Liberation Serif", status: "substituted" },
    Calibri: { family: "DejaVu Sans", status: "fallback" },
  },
};

vi.mock("../../../lib/api/figureRenderInfo", () => ({
  fetchFigureFonts: vi.fn(() => Promise.resolve(FONTS)),
}));

afterEach(() => vi.clearAllMocks());

describe("font picker", () => {
  it("lists the proprietary names by what they render as, then the installed families", () => {
    const opts = fontOptions(FONTS, undefined);
    expect(opts.map((o) => o.value)).toEqual(["", "Arial", "Times New Roman", "Calibri", "DejaVu Sans", "Liberation Sans", "Liberation Serif"]);
    expect(opts.find((o) => o.value === "Arial")?.label).toBe("Arial → Liberation Sans");
    expect(opts.find((o) => o.value === "Calibri")?.label).toBe("Calibri (not installed → DejaVu Sans)");
  });

  it("keeps an unknown current font instead of silently changing it", () => {
    expect(fontOptions(FONTS, "Comic Neue").at(-1)).toEqual({ value: "Comic Neue", label: "Comic Neue (not installed)" });
  });

  it("says when the export will substitute or fall back", () => {
    expect(fontNote(FONTS, "Arial")).toMatch(/metric-compatible Liberation Sans/);
    expect(fontNote(FONTS, "Calibri")).toMatch(/fall back to DejaVu Sans/);
    expect(fontNote(FONTS, "Comic Neue")).toMatch(/fall back to DejaVu/);
    expect(fontNote(FONTS, "Liberation Sans")).toBeNull();
    expect(fontNote(FONTS, undefined)).toBeNull();
  });
});

describe("TypographyPanel", () => {
  it("offers a size for every text element, each patching its own override", async () => {
    const patch = vi.fn();
    render(<TypographyPanel overrides={{}} patch={patch} />);
    for (const [label, key] of [
      ["font size", "font_size"],
      ["title size", "title_size"],
      ["axis label size", "label_size"],
      ["tick label size", "tick_size"],
      ["legend size", "legend_size"],
    ] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: "12" } });
      expect(patch).toHaveBeenLastCalledWith({ [key]: 12 });
    }
    // The picker fills from the server list (wait on the rendered option, not the fetch).
    expect(await screen.findByRole("option", { name: "Arial → Liberation Sans" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("font name"), { target: { value: "Arial" } });
    expect(patch).toHaveBeenLastCalledWith({ font_name: "Arial" });
  });

  it("shows the fallback note for the chosen font", async () => {
    render(<TypographyPanel overrides={{ font_name: "Calibri" }} patch={vi.fn()} />);
    expect(await screen.findByRole("status")).toHaveTextContent("Calibri is not installed; exports fall back to DejaVu Sans.");
  });
});
