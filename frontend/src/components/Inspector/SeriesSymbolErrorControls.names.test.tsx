// The error-style radios (Bars / Band / Box) sit in the same series-style section as the line-style
// radios, which include "Both" (line + symbol). A radio's accessible name is matched by substring, so
// the Box radio's old label ("... (needs both bound)") answered a `name: "Both"` query as a second
// "Both" (found by the mouse-editing-journey e2e). Each radio's name starts with its visible label
// (WCAG label-in-name) and none of them contains another radio's word.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SeriesSymbolErrorControls from "./SeriesSymbolErrorControls";

describe("SeriesSymbolErrorControls accessible names", () => {
  it("the error-style radios start with their visible label and never say 'both'", () => {
    render(<SeriesSymbolErrorControls channel={0} style={{}} setSeriesStyle={vi.fn()} markers errors />);
    const radios = screen.getAllByRole("radio");
    const names = radios.map((r) => r.getAttribute("aria-label") ?? r.textContent ?? "");
    const box = radios.find((r) => r.textContent === "Box");
    expect(box?.getAttribute("aria-label")).toMatch(/^Box:/);
    expect(names.filter((n) => /both/i.test(n))).toEqual([]);
    expect(screen.queryAllByRole("radio", { name: "Both" })).toHaveLength(0);
  });

  it("lays the error-bar controls in labelled rows whose label and box never separate", () => {
    render(<SeriesSymbolErrorControls channel={0} style={{}} setSeriesStyle={vi.fn()} markers={false} errors />);
    const group = (label: string) => screen.getByText(label).parentElement as HTMLElement;
    for (const [label, name] of [["cap", "Error bar cap size"], ["width", "Error bar line width"]] as const) {
      expect(group(label).style.whiteSpace).toBe("nowrap");
      expect(group(label)).toContainElement(screen.getByLabelText(name));
    }
    // mode, cap + width, and colour are three separate rows
    const rows = new Set([screen.getByText("Error bars"), screen.getByText("cap"), screen.getByText("width"), screen.getByText("color: series")].map((e) => e.closest("div")));
    expect(rows.size).toBe(3);
  });
});
