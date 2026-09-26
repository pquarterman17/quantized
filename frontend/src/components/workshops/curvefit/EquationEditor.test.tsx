// Inline syntax feedback in the custom-equation editor (audit P2.7 slice 2):
// the validate route's error span is underlined in the field, the message
// sits under it, and a stale span is never drawn on newer text.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { validateEquation } from "../../../lib/api/curvefit";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import EquationModelPanel from "./EquationModelPanel";

vi.mock("../../../lib/api", () => ({
  fetchBookData: vi.fn(),
}));
vi.mock("../../../lib/api/curvefit", () => ({
  validateEquation: vi.fn(),
  fitEquation: vi.fn(),
  findXY: vi.fn(),
}));

const DATA: DataStruct = { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} };
const ASTRAL = String.fromCodePoint(0x1f600);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    seriesOrder: null,
    fitOverlay: null,
  });
});

function renderWith(text: string) {
  render(<EquationModelPanel initial={null} onSavedChange={() => {}} />);
  fireEvent.change(screen.getByLabelText("Equation"), { target: { value: text } });
}

describe("EquationEditor inline error marking (P2.7)", () => {
  it("underlines exactly the reported span and shows the message", async () => {
    vi.mocked(validateEquation).mockResolvedValue({
      ok: false,
      params: [],
      error: 'Unknown function "foo". Known functions: exp (column 7)',
      errorStart: 6,
      errorEnd: 9,
    });
    renderWith("y = a*foo(x)");
    const mark = await screen.findByTestId("equation-error-mark");
    expect(mark).toHaveTextContent(/^foo$/);
    // The overlay mirrors the whole text so the mark sits over those glyphs.
    expect(screen.getByTestId("equation-error-overlay")).toHaveTextContent("y = a*foo(x)");
    const input = screen.getByLabelText("Equation");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const message = screen.getByRole("alert");
    expect(message).toHaveTextContent('Unknown function "foo"');
    expect(input.getAttribute("aria-describedby")).toBe(message.id);
  });

  it("converts an astral-character offset before marking", async () => {
    vi.mocked(validateEquation).mockResolvedValue({
      ok: false,
      params: [],
      error: 'Unexpected character ";" (column 4)',
      errorStart: 3,
      errorEnd: 4,
    });
    renderWith(`${ASTRAL}+a;b`);
    expect(await screen.findByTestId("equation-error-mark")).toHaveTextContent(/^;$/);
  });

  it("draws nothing for an error without a span", async () => {
    vi.mocked(validateEquation).mockRejectedValue(new Error("validation unavailable"));
    renderWith("a*x");
    expect(await screen.findByRole("alert")).toHaveTextContent("validation unavailable");
    expect(screen.queryByTestId("equation-error-mark")).toBeNull();
  });

  // DOM-level: the mark is gone once the keystroke has settled. The stricter
  // per-render guarantee (no render pairs the old span with new text) is
  // pinned in useEquationFit.hold.test.ts, where each render is observable.
  it("clears the mark as soon as the text changes", async () => {
    vi.mocked(validateEquation).mockResolvedValue({
      ok: false,
      params: [],
      error: "bad (column 3)",
      errorStart: 2,
      errorEnd: 3,
    });
    renderWith("a+;");
    await screen.findByTestId("equation-error-mark");
    // A keystroke: the old span belongs to "a+;", not to "a+;b". The next
    // validate never settles, so only the text-binding can clear the mark.
    vi.mocked(validateEquation).mockReturnValue(new Promise(() => {}));
    fireEvent.change(screen.getByLabelText("Equation"), { target: { value: "a+;b" } });
    expect(screen.queryByTestId("equation-error-mark")).toBeNull();
    await waitFor(() => expect(screen.getByLabelText("Equation")).toHaveAttribute("aria-invalid", "false"));
  });

  it("clears the mark once the equation validates", async () => {
    vi.mocked(validateEquation).mockResolvedValueOnce({
      ok: false,
      params: [],
      error: "bad (column 3)",
      errorStart: 2,
      errorEnd: 3,
    });
    renderWith("a+;");
    await screen.findByTestId("equation-error-mark");
    vi.mocked(validateEquation).mockResolvedValue({ ok: true, params: ["a"], usesX: false });
    fireEvent.change(screen.getByLabelText("Equation"), { target: { value: "a" } });
    await waitFor(() => expect(screen.getByLabelText("Equation")).toHaveAttribute("aria-invalid", "false"));
    expect(screen.queryByTestId("equation-error-mark")).toBeNull();
  });
});
