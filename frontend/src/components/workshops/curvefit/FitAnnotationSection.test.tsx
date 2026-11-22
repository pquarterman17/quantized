// "Result on graph": opt-in, follows re-fits, withheld when out of date, never
// overwrites a hand edit, and reaches the export request.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { viewOverrides } from "../../../lib/figureViewOverrides";
import { resetFitAnnotationLinks } from "../../../store/fitAnnotationLinks";
import { useApp } from "../../../store/useApp";
import FitAnnotationSection from "./FitAnnotationSection";
import { useFitAnnotationGuard } from "./useFitAnnotation";

const input = (m: number) => ({
  model: "Linear",
  names: ["m", "b"],
  result: { params: [m, 1], errors: [0.1, 0.1], R2: 0.99, nPoints: 9, nFree: 2 },
  xUnit: "",
  yUnit: "",
});

function ui(m: number, stale = false) {
  return <FitAnnotationSection fitId="d1:0" input={input(m)} stale={stale} />;
}
const texts = () => useApp.getState().annotations.map((a) => a.text);

beforeEach(() => {
  resetFitAnnotationLinks();
  useApp.setState({ annotations: [], history: [], future: [] });
});

function open() {
  fireEvent.click(screen.getByText("Result on graph"));
}

describe("FitAnnotationSection", () => {
  it("draws nothing until Add to graph (opt-in)", () => {
    render(ui(2));
    expect(texts()).toEqual([]);
  });

  it("adds one page-anchored, dot-less annotation in one undo step", async () => {
    render(ui(2));
    open();
    fireEvent.click(screen.getByRole("button", { name: "Add to graph" }));
    expect(useApp.getState().annotations).toHaveLength(1);
    expect(useApp.getState().annotations[0]).toMatchObject({ anchor: "page", dot: false, text: expect.stringContaining("m = 2.00 ± 0.10") });
    await waitFor(() => expect(useApp.getState().history).toHaveLength(1));
    act(() => useApp.getState().undo());
    expect(texts()).toEqual([]);
  });

  it("a re-fit rewrites the same annotation in place, with no extra undo step", async () => {
    const { rerender } = render(ui(2));
    open();
    fireEvent.click(screen.getByRole("button", { name: "Add to graph" }));
    const id = useApp.getState().annotations[0]!.id;
    await waitFor(() => expect(useApp.getState().history).toHaveLength(1));
    const steps = useApp.getState().history.length;
    rerender(ui(3));
    expect(useApp.getState().annotations).toHaveLength(1);
    expect(useApp.getState().annotations[0]).toMatchObject({ id, text: expect.stringContaining("m = 3.00 ± 0.10") });
    expect(useApp.getState().history).toHaveLength(steps);
  });

  it("an out-of-date fit marks the text and refuses a new add; a fresh fit clears the mark", () => {
    const { rerender } = render(ui(2));
    open();
    fireEvent.click(screen.getByRole("button", { name: "Add to graph" }));
    rerender(ui(2, true));
    expect(texts()[0]).toMatch(/m = 2\.00 ± 0\.10.*\(out of date\)$/);
    expect(screen.getByText(/Out of date: the graph text is marked/)).toBeTruthy();
    rerender(ui(3));
    expect(texts()[0]).not.toContain("out of date");
    expect(texts()[0]).toContain("m = 3.00");
  });

  it("with no completed fit result the annotation is marked out of date (guard)", () => {
    const { rerender } = render(ui(2));
    open();
    fireEvent.click(screen.getByRole("button", { name: "Add to graph" }));
    function Guard({ has }: { has: boolean }) {
      useFitAnnotationGuard("d1", has);
      return null;
    }
    render(<Guard has={true} />);
    expect(texts()[0]).not.toContain("out of date");
    rerender(<div />);
    const g = render(<Guard has={false} />);
    expect(texts()[0]).toMatch(/\(out of date\)$/);
    g.unmount();
  });

  it("a hand-edited annotation is not marked by the guard", () => {
    render(ui(2));
    open();
    fireEvent.click(screen.getByRole("button", { name: "Add to graph" }));
    act(() => useApp.getState().updateAnnotation(useApp.getState().annotations[0]!.id, { text: "mine" }));
    function Guard() {
      useFitAnnotationGuard("d1", false);
      return null;
    }
    render(<Guard />);
    expect(texts()).toEqual(["mine"]);
  });

  it("Add is disabled while the fit is out of date", () => {
    render(ui(2, true));
    open();
    expect((screen.getByRole("button", { name: "Add to graph" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("never overwrites text the user edited; Replace my edit restores it", () => {
    const { rerender } = render(ui(2));
    open();
    fireEvent.click(screen.getByRole("button", { name: "Add to graph" }));
    const id = useApp.getState().annotations[0]!.id;
    act(() => useApp.getState().updateAnnotation(id, { text: "my own note" }));
    rerender(ui(3));
    expect(texts()).toEqual(["my own note"]);
    expect(screen.getByText(/You edited this text/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Replace my edit" }));
    expect(texts()[0]).toContain("m = 3.00");
  });

  it("options regenerate the text; Remove from graph deletes the annotation", () => {
    render(ui(2));
    open();
    fireEvent.click(screen.getByRole("button", { name: "Add to graph" }));
    fireEvent.click(screen.getByLabelText("Include equation"));
    expect(texts()[0]).not.toContain("y = ");
    fireEvent.click(screen.getByRole("button", { name: "Remove from graph" }));
    expect(texts()).toEqual([]);
  });

  it("the annotation is in the vector-export request (screen and export agree)", () => {
    render(ui(2));
    open();
    fireEvent.click(screen.getByRole("button", { name: "Add to graph" }));
    const ann = viewOverrides(useApp.getState())?.annotations ?? [];
    expect(ann).toHaveLength(1);
    expect(ann[0]).toMatchObject({ anchor: "page", dot: false, text: texts()[0] });
  });
});
