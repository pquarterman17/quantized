// "Overlay these N": hidden below two outputs; with the REAL plotSelectedTogether
// the overlay is exactly one undo step.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import OverlayOutputsButton from "./OverlayOutputsButton";

vi.mock("../../store/toasts", () => ({ toast: vi.fn() }));

const sheet = (id: string): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["v"], units: ["emu"], metadata: {} },
});

beforeEach(() => {
  useApp.setState({ datasets: [sheet("a"), sheet("b"), sheet("c")], folders: [], activeId: "a", selectedIds: [], history: [], future: [] });
});

describe("OverlayOutputsButton", () => {
  it("renders nothing for fewer than two outputs", () => {
    const { container } = render(<OverlayOutputsButton ids={["a"]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("overlays the outputs as ONE undo step", async () => {
    render(<OverlayOutputsButton ids={["a", "b", "c"]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "◇ Overlay these 3" }));
    });
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4));
    expect(useApp.getState().history).toHaveLength(1);
    act(() => useApp.getState().undo());
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["a", "b", "c"]);
  });
});
