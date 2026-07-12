// PlotToolbar — the shape dock flyout (MAIN #27): a ▱ button opening a
// small flyout of Arrow/Line/Rectangle/Ellipse/Text box, each setting the
// store's drawShapeKind (the plot-side counterpart of the Insert menu).

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useApp } from "../../store/useApp";
import PlotToolbar from "./PlotToolbar";

const ORIGINAL = useApp.getState();

// The global setup.ts afterEach already calls RTL's cleanup() (which
// properly unmounts the flyout's document.body portal) — a manual
// `document.body.innerHTML = ""` here would fight it (React still thinks
// its portal node is attached after the DOM is nuked out from under it).
afterEach(() => {
  useApp.setState(ORIGINAL, true);
});

const NOOP = () => {};
const props = {
  onReset: NOOP,
  onSmartScale: NOOP,
  onSavePng: NOOP,
  onCopyData: NOOP,
  onSnapshot: NOOP,
  onSnapshotWindow: NOOP,
};

describe("PlotToolbar — shape dock flyout (MAIN #27)", () => {
  it("renders the ▱ dock button", () => {
    render(<PlotToolbar {...props} />);
    expect(screen.getByTitle(/draw a shape/i)).toBeInTheDocument();
  });

  it("clicking the dock button opens a flyout listing all five entries", () => {
    render(<PlotToolbar {...props} />);
    fireEvent.click(screen.getByTitle(/draw a shape/i));
    for (const label of [/arrow/i, /line/i, /rectangle/i, /ellipse/i, /text box/i]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("picking 'Arrow' sets the store's drawShapeKind and closes the flyout", () => {
    render(<PlotToolbar {...props} />);
    fireEvent.click(screen.getByTitle(/draw a shape/i));
    fireEvent.click(screen.getByText(/arrow/i));
    expect(useApp.getState().drawShapeKind).toBe("arrow");
    expect(screen.queryByText(/rectangle/i)).toBeNull(); // flyout closed
  });

  it("picking 'Text box' sets drawShapeKind to 'textbox'", () => {
    render(<PlotToolbar {...props} />);
    fireEvent.click(screen.getByTitle(/draw a shape/i));
    fireEvent.click(screen.getByText(/text box/i));
    expect(useApp.getState().drawShapeKind).toBe("textbox");
  });

  it("the dock button reads active while a draw mode is set", () => {
    useApp.setState({ drawShapeKind: "line" });
    render(<PlotToolbar {...props} />);
    expect(screen.getByTitle(/draw a shape/i).className).toMatch(/active/);
  });
});
