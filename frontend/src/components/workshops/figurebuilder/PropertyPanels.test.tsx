import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { FigureOverrides } from "../../../lib/figureOverrides";
import PropertyPanels from "./PropertyPanels";

function Harness({
  initial,
  openGroup,
  onChange = vi.fn(),
}: {
  initial: FigureOverrides;
  openGroup: string;
  onChange?: (overrides: FigureOverrides) => void;
}) {
  const [overrides, setOverrides] = useState(initial);
  return (
    <PropertyPanels
      overrides={overrides}
      openGroup={openGroup}
      setOverrides={(next) => {
        onChange(next);
        setOverrides(next);
      }}
    />
  );
}

describe("PropertyPanels publication parity controls", () => {
  it("keeps an unfinished numeric edit while synchronizing a replaced draft value", async () => {
    const { rerender } = render(
      <PropertyPanels
        overrides={{ y2_lim: [1, 2] }}
        openGroup="Axes & ticks"
        setOverrides={vi.fn()}
      />,
    );
    const y2Min = await screen.findByLabelText("y2 min");
    fireEvent.change(y2Min, { target: { value: "1." } });
    expect(y2Min).toHaveValue("1.");

    rerender(
      <PropertyPanels
        overrides={{ y2_lim: [8, 9] }}
        openGroup="Axes & ticks"
        setOverrides={vi.fn()}
      />,
    );
    expect(await screen.findByLabelText("y2 min")).toHaveValue("8");
  });

  it("edits y2 limits and only adds finite ordered x-axis breaks", async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ y2_lim: [1, 2] }} openGroup="Axes & ticks" onChange={onChange} />);

    fireEvent.change(await screen.findByLabelText("y2 min"), { target: { value: "3" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ y2_lim: [3, 2] }));

    const add = screen.getByRole("button", { name: "Add break" });
    fireEvent.change(screen.getByLabelText("break from"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("break to"), { target: { value: "2" } });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText("break to"), { target: { value: "8" } });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ x_breaks: [[5, 8]] }));

    fireEvent.change(screen.getByLabelText("break from"), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText("break to"), { target: { value: "9" } });
    expect(add).toBeDisabled();

    fireEvent.change(screen.getByLabelText("break from"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("break to"), { target: { value: "4" } });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ x_breaks: [[1, 4], [5, 8]] }));

    fireEvent.click(screen.getByRole("button", { name: "Remove x-axis break 1" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ x_breaks: [[5, 8]] }));
    fireEvent.click(screen.getByRole("button", { name: "Remove x-axis break 1" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ x_breaks: [] }));
  });

  it("edits a legend title and all supported annotation fields in place", async () => {
    const onLegend = vi.fn();
    const { unmount } = render(<Harness initial={{ legend: {} }} openGroup="Legend" onChange={onLegend} />);
    fireEvent.change(await screen.findByLabelText("legend title"), { target: { value: "Samples" } });
    expect(onLegend).toHaveBeenLastCalledWith(expect.objectContaining({ legend: { title: "Samples" } }));
    unmount();

    const onAnnotation = vi.fn();
    render(
      <Harness
        initial={{ annotations: [{ text: "Old", x: 1, y: 2 }] }}
        openGroup="Annotations"
        onChange={onAnnotation}
      />,
    );
    fireEvent.change(await screen.findByLabelText("annotation 1 text"), { target: { value: "New" } });
    fireEvent.change(screen.getByLabelText("annotation 1 x"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("annotation 1 y"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("annotation 1 font size"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("annotation 1 anchor"), { target: { value: "page" } });
    fireEvent.change(screen.getByLabelText("annotation 1 frame fill"), { target: { value: "#fff" } });
    fireEvent.change(screen.getByLabelText("annotation 1 frame stroke"), { target: { value: "#000" } });
    fireEvent.change(screen.getByLabelText("annotation 1 frame opacity"), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText("annotation 1 frame padding"), { target: { value: "4" } });
    expect(onAnnotation).toHaveBeenLastCalledWith({
      annotations: [{
        text: "New",
        x: 3,
        y: 4,
        size: 12,
        anchor: "page",
        frame: { fill: "#fff", stroke: "#000", opacity: 0.5, pad: 4 },
      }],
    });

    const x = screen.getByLabelText("annotation 1 x");
    fireEvent.change(x, { target: { value: "" } });
    fireEvent.blur(x);
    expect(x).toHaveValue("3");

    fireEvent.change(screen.getByLabelText("new annotation text"), { target: { value: "Missing coordinates" } });
    expect(screen.getByRole("button", { name: "+ Add" })).toBeDisabled();
  });

  it("uses a sane positivity floor for font-size fields instead of Number.MIN_VALUE", async () => {
    render(<PropertyPanels overrides={{}} openGroup="Text & fonts" setOverrides={vi.fn()} />);
    expect(await screen.findByLabelText("font size")).toHaveAttribute("min", "1");
    expect(screen.getByLabelText("title size")).toHaveAttribute("min", "1");
  });

  it("computes an Add-break reason, shown as a hint once both bounds are entered and as the disabled button's tooltip", () => {
    const onChange = vi.fn();
    render(<Harness initial={{}} openGroup="Axes & ticks" onChange={onChange} />);
    const addButton = () => screen.getByRole("button", { name: "Add break" });
    const addSpan = () => addButton().closest("span")!;

    // Both blank: disabled, generic tooltip, but no inline hint yet (nothing
    // to point at until the user has entered something).
    expect(addButton()).toBeDisabled();
    expect(addSpan()).toHaveAttribute("title", "enter both bounds");
    expect(screen.queryByText("enter both bounds")).not.toBeInTheDocument();

    const from = screen.getByLabelText("break from");
    const to = screen.getByLabelText("break to");

    fireEvent.change(from, { target: { value: "abc" } });
    fireEvent.change(to, { target: { value: "5" } });
    expect(screen.getByText("bounds must be numbers")).toBeInTheDocument();
    expect(addSpan()).toHaveAttribute("title", "bounds must be numbers");
    expect(addButton()).toBeDisabled();

    fireEvent.change(from, { target: { value: "9" } });
    expect(screen.getByText("'from' must be less than 'to'")).toBeInTheDocument();
    expect(addSpan()).toHaveAttribute("title", "'from' must be less than 'to'");

    fireEvent.change(from, { target: { value: "1" } });
    fireEvent.change(to, { target: { value: "3" } });
    expect(screen.queryByText(/must be|overlaps|enter both/)).not.toBeInTheDocument();
    expect(addSpan()).toHaveAttribute("title", "Omit a finite, non-overlapping x-range in the export");
    expect(addButton()).toBeEnabled();
    fireEvent.click(addButton());
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ x_breaks: [[1, 3]] }));

    fireEvent.change(from, { target: { value: "2" } });
    fireEvent.change(to, { target: { value: "4" } });
    expect(screen.getByText("overlaps an existing break")).toBeInTheDocument();
    expect(addSpan()).toHaveAttribute("title", "overlaps an existing break");
    expect(addButton()).toBeDisabled();
  });
});

describe("PropertyPanels — reopening a manually-collapsed group (item 5/6)", () => {
  it("reopens a group on re-selection of the SAME group via openNonce, and scrolls it into view", () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    // jsdom has no layout engine and no native scrollIntoView; the component
    // optional-chains the call for exactly that reason (see PropertyPanels.tsx).
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const { rerender } = render(
        <PropertyPanels overrides={{}} openGroup="Legend" openNonce={1} setOverrides={vi.fn()} />,
      );
      // forceOpen alone opens it on mount, and scrolls it into view once.
      expect(screen.getByLabelText("legend title")).toBeInTheDocument();
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
      scrollIntoView.mockClear();

      // Manually collapse via the group header.
      fireEvent.click(screen.getByRole("button", { name: /Legend/ }));
      expect(screen.queryByLabelText("legend title")).not.toBeInTheDocument();

      // Re-selecting the SAME group (openGroup unchanged, forceOpen still
      // true) does nothing by itself — but a bumped openNonce must reopen it.
      rerender(<PropertyPanels overrides={{}} openGroup="Legend" openNonce={1} setOverrides={vi.fn()} />);
      expect(screen.queryByLabelText("legend title")).not.toBeInTheDocument();

      rerender(<PropertyPanels overrides={{}} openGroup="Legend" openNonce={2} setOverrides={vi.fn()} />);
      expect(screen.getByLabelText("legend title")).toBeInTheDocument();
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});
