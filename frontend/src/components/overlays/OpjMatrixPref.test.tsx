import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { PREF_DEFAULTS } from "../../store/prefs";
import { useApp } from "../../store/useApp";
import { OpjMatrixPref } from "./OpjMatrixPref";

afterEach(() => useApp.setState({ opjWriteMatrices: false }));

describe("OpjMatrixPref (Origin .opj export: matrices as Origin matrices)", () => {
  it("is off by default and says it is not yet verified in Origin", () => {
    expect(PREF_DEFAULTS.opjWriteMatrices).toBe(false);
    render(<OpjMatrixPref />);
    expect(screen.getByText(/not yet verified in Origin/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Write matrix books as Origin matrices" })).not.toBeChecked();
  });

  it("turns the preference on", () => {
    render(<OpjMatrixPref />);
    fireEvent.click(screen.getByRole("switch", { name: "Write matrix books as Origin matrices" }));
    expect(useApp.getState().opjWriteMatrices).toBe(true);
  });
});
