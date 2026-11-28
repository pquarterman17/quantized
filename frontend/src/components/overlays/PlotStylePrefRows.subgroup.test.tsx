import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { useApp } from "../../store/useApp";
import PlotStylePrefRows from "./PlotStylePrefRows";

describe("Preferences > Plot: the subgroup size survives the Vary dash & marker switch", () => {
  it("turning the switch off and on restores the size", async () => {
    act(() => useApp.getState().setPref("autoSeriesStyles", 3));
    render(<PlotStylePrefRows />);
    const sw = screen.getByRole("switch", { name: "Vary dash and marker" });
    await userEvent.click(sw);
    expect(useApp.getState().autoSeriesStyles).toBe(false);
    await userEvent.click(sw);
    expect(useApp.getState().autoSeriesStyles).toBe(3);
  });
});
