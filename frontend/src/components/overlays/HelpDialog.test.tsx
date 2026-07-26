import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import HelpDialog from "./HelpDialog";
import { useHelp } from "../../store/help";

/** Match a help row by its title's FULL text — a highlighted title is split
 *  into per-character <mark> nodes, so getByText("full string") can't see it. */
function titleShown(name: string): boolean {
  return [...document.querySelectorAll(".qzk-help-title")].some((el) => el.textContent === name);
}

beforeEach(() =>
  useHelp.setState({ open: false, section: "search", query: "" }),
);
afterEach(() => act(() => useHelp.getState().closeHelp()));

describe("HelpDialog", () => {
  it("renders nothing until opened", () => {
    const { container } = render(<HelpDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens on the Topics tab and lists tools", () => {
    render(<HelpDialog />);
    act(() => useHelp.getState().openHelp());
    expect(screen.getByRole("dialog", { name: "Help" })).toBeInTheDocument();
    expect(screen.getByText("Curve fit")).toBeInTheDocument();
    // The menu path is shown so the user knows where to find it.
    expect(screen.getAllByText(/^Analyze ▸ /)[0]).toBeInTheDocument();
  });

  it("filters the list as the user types", () => {
    render(<HelpDialog />);
    act(() => useHelp.getState().openHelp());
    fireEvent.change(screen.getByLabelText("Search help"), { target: { value: "hyster" } });
    expect(titleShown("Hysteresis analysis")).toBe(true);
    expect(titleShown("Curve fit")).toBe(false);
  });

  it("finds a tool by a keyword that isn't in its title", () => {
    render(<HelpDialog />);
    act(() => useHelp.getState().openHelp());
    fireEvent.change(screen.getByLabelText("Search help"), { target: { value: "coercivity" } });
    expect(titleShown("Hysteresis analysis")).toBe(true);
  });

  it("searches Plot commands by their plain-language descriptions", () => {
    render(<HelpDialog />);
    act(() => useHelp.getState().openHelp());
    fireEvent.change(screen.getByLabelText("Search help"), {
      target: { value: "discontinuous" },
    });
    expect(titleShown("Break x-axis at gaps")).toBe(true);
    expect(screen.getByText("Plot ▸ Layout")).toBeInTheDocument();
  });

  it("searches File and Data commands by outcomes rather than menu labels", () => {
    render(<HelpDialog />);
    act(() => useHelp.getState().openHelp());
    fireEvent.change(screen.getByLabelText("Search help"), {
      target: { value: "recovery snapshot" },
    });
    expect(titleShown("Clear autosaved workspace")).toBe(true);

    fireEvent.change(screen.getByLabelText("Search help"), {
      target: { value: "matching values" },
    });
    expect(titleShown("Join datasets by key")).toBe(true);
  });

  it("shows an empty state for no matches", () => {
    render(<HelpDialog />);
    act(() => useHelp.getState().openHelp());
    fireEvent.change(screen.getByLabelText("Search help"), { target: { value: "zzxqwv" } });
    expect(screen.getByText("No matching topics")).toBeInTheDocument();
  });

  it("switches to the Keyboard & mouse tab and shows shortcut rows", () => {
    render(<HelpDialog />);
    act(() => useHelp.getState().openHelp());
    fireEvent.click(screen.getByRole("tab", { name: "Keyboard & mouse" }));
    expect(screen.getByText("Open the command palette")).toBeInTheDocument();
    // No search box on that tab.
    expect(screen.queryByLabelText("Search help")).not.toBeInTheDocument();
  });

  it("can be opened directly to a section", () => {
    render(<HelpDialog />);
    act(() => useHelp.getState().openHelp("shortcuts"));
    expect(screen.getByRole("tab", { name: "Keyboard & mouse" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("opens from contextual help with the relevant topic already filtered", () => {
    render(<HelpDialog />);
    act(() => useHelp.getState().openTopic("axis scale"));
    expect(screen.getByLabelText("Search help")).toHaveValue("axis scale");
    expect(titleShown("Cycle Y axis scale (linear/log/reciprocal)")).toBe(true);
  });

  it("closes on the backdrop, the Close button, and Escape", () => {
    const { container } = render(<HelpDialog />);

    act(() => useHelp.getState().openHelp());
    fireEvent.mouseDown(container.querySelector(".qz-overlay-backdrop")!);
    expect(useHelp.getState().open).toBe(false);

    act(() => useHelp.getState().openHelp());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(useHelp.getState().open).toBe(false);

    act(() => useHelp.getState().openHelp());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useHelp.getState().open).toBe(false);
  });

  it("resets the query between opens", () => {
    render(<HelpDialog />);
    act(() => useHelp.getState().openHelp());
    fireEvent.change(screen.getByLabelText("Search help"), { target: { value: "hyster" } });
    act(() => useHelp.getState().closeHelp());
    act(() => useHelp.getState().openHelp());
    expect(screen.getByLabelText("Search help")).toHaveValue("");
  });
  it("search covers import formats, not just tools", () => {
    render(<HelpDialog />);
    act(() => useHelp.getState().openHelp());
    fireEvent.change(screen.getByLabelText("Search help"), { target: { value: "xrdml" } });
    expect(titleShown("PANalytical XRDML")).toBe(true);
  });

  it("the Importing data tab lists formats grouped by category", () => {
    render(<HelpDialog />);
    act(() => useHelp.getState().openHelp("importing"));
    expect(screen.getByRole("tab", { name: "Importing data" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("OriginLab project")).toBeInTheDocument();
    expect(screen.getByText("X-ray & diffraction")).toBeInTheDocument();
    // The extension chip is shown so the user knows what to pick.
    expect(screen.getByText(".xrdml")).toBeInTheDocument();
    // No search box on a browse tab.
    expect(screen.queryByLabelText("Search help")).not.toBeInTheDocument();
  });
  it("the From Origin tab maps Origin workflows to quantized", () => {
    render(<HelpDialog />);
    act(() => useHelp.getState().openHelp("origin"));
    expect(screen.getByRole("tab", { name: "From Origin" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Analysis ▸ Fitting (linear / nonlinear)")).toBeInTheDocument();
  });

  it("search covers Origin migration tips too", () => {
    render(<HelpDialog />);
    act(() => useHelp.getState().openHelp());
    fireEvent.change(screen.getByLabelText("Search help"), { target: { value: "fitting" } });
    expect(titleShown("Analysis ▸ Fitting (linear / nonlinear)")).toBe(true);
  });
});

describe("HelpDialog startup boundary", () => {
  const overlaysSrc = Object.values(
    import.meta.glob("../../AppOverlays.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  )[0] as string;

  it("loads the catalog only after the standalone Help store opens", () => {
    expect(overlaysSrc).toContain(
      'const HelpDialog = lazyPanel(() => import("./components/overlays/HelpDialog"))',
    );
    expect(overlaysSrc).toContain("{helpOpen && <HelpDialog />}");
  });
});
