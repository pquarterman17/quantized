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
});
