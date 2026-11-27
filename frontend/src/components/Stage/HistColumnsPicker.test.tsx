// The "+ columns" list of the Stat Stage histogram: its popover must not be clipped by the toolbar it sits in
// (an absolute list inside the scrolling toolbar cut the later columns off), so it is positioned fixed.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import HistColumnsPicker from "./HistColumnsPicker";

const COLUMNS = ["A", "B", "C", "D"].map((label, index) => ({ index, label })) as never;

describe("HistColumnsPicker", () => {
  it("opens a fixed list, outside the scrolling toolbar's clip, with every other column in it", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <div style={{ overflowY: "auto", maxHeight: 40 }}>
        <HistColumnsPicker columns={COLUMNS} valueCol={0} picked={[]} onChange={onChange} />
      </div>,
    );
    fireEvent.click(screen.getByText("+ columns"));
    const list = await waitFor(() => {
      const el = container.querySelector<HTMLElement>(".qzk-popover");
      expect(el?.style.position).toBe("fixed");
      return el!;
    });
    expect(list.style.top).not.toBe("");
    for (const name of ["B", "C", "D"]) expect(screen.getByRole("checkbox", { name })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "A" })).toBeNull(); // the value column is not an extra
    fireEvent.click(screen.getByRole("checkbox", { name: "D" }));
    expect(onChange).toHaveBeenCalledWith([3]);
  });
});
