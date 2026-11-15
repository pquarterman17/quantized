// The waterfall workshop's 3-D section: the preview is the server render of the
// same body the export sends; a refusal reads as a reason.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/mapFigure", () => ({
  exportMapFigure: vi.fn(() => Promise.resolve()),
  renderMapFigure: vi.fn(() => Promise.resolve(new Blob(["png"], { type: "image/png" }))),
}));

import { exportMapFigure, renderMapFigure } from "../../../lib/api/mapFigure";
import type { WaterfallSeries } from "../../../lib/waterfall";
import { useApp } from "../../../store/useApp";
import Waterfall3dSection from "./Waterfall3dSection";

const S = (label: string, y: number[]): WaterfallSeries => ({ id: label, label, x: [0, 1, 2], y, range: 1 });
const two = [S("a 10", [1, 2, 3]), S("b 20", [4, 5, 6])];

beforeEach(() => {
  vi.mocked(exportMapFigure).mockClear();
  vi.mocked(renderMapFigure).mockClear();
  useApp.setState({ status: "" });
});

describe("Waterfall3dSection", () => {
  it("previews the server render and exports the same request in the chosen format", async () => {
    render(<Waterfall3dSection series={two} channel="Signal" />);
    const img = await screen.findByAltText("3-D waterfall preview");
    expect(img.getAttribute("src")).toMatch(/^data:/);
    const preview = vi.mocked(renderMapFigure).mock.calls.at(-1)![0];
    fireEvent.click(screen.getByText("Export 3-D SVG"));
    await waitFor(() => expect(useApp.getState().status).toBe("exported waterfall3d_Signal.svg"));
    const exported = vi.mocked(exportMapFigure).mock.calls[0]![0];
    expect({ ...exported, fmt: "", filename: "" }).toEqual({ ...preview, fmt: "", filename: "" });
    expect(exported).toMatchObject({ kind: "waterfall", fmt: "svg", contour_source: "curves" });
    expect(exported.curves?.map((c) => c.depth)).toEqual([0, 1]);
  });

  it("depth by number in name; one curve is refused with the reason and nothing is requested", async () => {
    const { rerender } = render(<Waterfall3dSection series={two} channel="Signal" />);
    fireEvent.change(screen.getByLabelText("Depth by"), { target: { value: "number" } });
    await screen.findByAltText("3-D waterfall preview");
    expect(vi.mocked(renderMapFigure).mock.calls.at(-1)![0].curves?.map((c) => c.depth)).toEqual([10, 20]);
    vi.mocked(renderMapFigure).mockClear();
    rerender(<Waterfall3dSection series={two.slice(0, 1)} channel="Signal" />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/at least 2 curves/);
    expect(screen.getByText("Export 3-D PDF").hasAttribute("disabled")).toBe(true);
    expect(renderMapFigure).not.toHaveBeenCalled();
  });

  it("angles commit on blur/Enter, not per keystroke; a blank or out-of-range angle is invalid, not 0", async () => {
    render(<Waterfall3dSection series={two} channel="Signal" />);
    await screen.findByAltText("3-D waterfall preview");
    const elev = screen.getByLabelText("Elevation (°)");
    vi.mocked(renderMapFigure).mockClear();
    fireEvent.change(elev, { target: { value: "4" } });
    fireEvent.change(elev, { target: { value: "45" } });
    await new Promise((r) => setTimeout(r, 600)); // longer than the render debounce
    expect(renderMapFigure).not.toHaveBeenCalled(); // typing alone requests nothing
    fireEvent.change(elev, { target: { value: "" } });
    fireEvent.blur(elev);
    expect(elev.getAttribute("aria-invalid")).toBe("false"); // restored, never committed as 0
    expect((elev as HTMLInputElement).value).toBe("30");
    fireEvent.change(elev, { target: { value: "45" } });
    fireEvent.keyDown(elev, { key: "Enter" });
    await waitFor(() => expect(vi.mocked(renderMapFigure).mock.calls.at(-1)?.[0].view_elev).toBe(45));
    expect(vi.mocked(renderMapFigure).mock.calls.every((c) => c[0].view_elev !== 0)).toBe(true);
  });
});
