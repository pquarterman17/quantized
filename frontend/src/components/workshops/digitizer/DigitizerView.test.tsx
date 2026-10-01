// The digitizer's single-field steps (the calibration value, the new
// dataset's name) are named by the caption shown beside them, not left
// unnamed next to a loose <span> (dialog-basics audit residual).

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DigitizerView from "./DigitizerView";
import { useDigitizer } from "./useDigitizer";

vi.mock("./useDigitizer", () => ({ useDigitizer: vi.fn() }));

type Digitizer = ReturnType<typeof useDigitizer>;

function stub(over: Partial<Digitizer>): void {
  const noop = vi.fn();
  vi.mocked(useDigitizer).mockReturnValue({
    image: "data:image/png;base64,", mode: "trace", refs: {}, traced: [], pending: null, ready: true,
    setImage: noop, click: noop, commit: noop, cancelPending: noop, undo: noop, reset: noop, create: noop,
    ...over,
  } as unknown as Digitizer);
}

describe("DigitizerView field names", () => {
  beforeEach(() => vi.mocked(useDigitizer).mockReset());

  it("names the new dataset's field by its caption", () => {
    stub({ mode: "trace" });
    render(<DigitizerView />);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("digitized");
  });

  it("names the calibration value field by the axis it sets", () => {
    stub({ mode: "x1", pending: { px: 1, py: 2 } } as Partial<Digitizer>);
    render(<DigitizerView />);
    expect(screen.getByRole("textbox", { name: "X value" })).toBeInTheDocument();
  });
});
