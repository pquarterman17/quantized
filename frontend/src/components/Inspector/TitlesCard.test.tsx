// Figures leftover e: the Inspector's "Titles & labels" fields had no
// accessible name (a visible caption, but nothing tying it to the input), and
// every row's Ω button was the same "Insert symbol". Each field is now named
// after its caption, uniquely in the app, and its Ω button after the field.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { defaultPlotView } from "../../lib/plotview";
import { useApp } from "../../store/useApp";
import TitlesCard from "./TitlesCard";

beforeEach(() => {
  useApp.setState({ ...defaultPlotView(), history: [], future: [] });
});

describe("TitlesCard accessible names", () => {
  it("names each field after its caption, and each Ω button after its field", () => {
    useApp.setState({ y2Keys: [1] });
    render(<TitlesCard />);
    for (const name of ["Plot title", "Plot X label", "Plot Y label", "Plot Y2 label"]) {
      expect(screen.getByRole("textbox", { name })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Insert symbol into ${name}` })).toBeInTheDocument();
    }
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(names.length);
  });

  it("the named field is the one that edits its label", () => {
    render(<TitlesCard />);
    const y = screen.getByRole("textbox", { name: "Plot Y label" });
    fireEvent.change(y, { target: { value: "Moment" } });
    fireEvent.blur(y);
    expect(useApp.getState().yAxisLabel).toBe("Moment");
    expect(useApp.getState().xAxisLabel).toBe("");
  });
});
