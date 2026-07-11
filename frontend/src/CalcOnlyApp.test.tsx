// Calc-only shell (MAIN_PLAN #22): must render the calculators content and
// a minimal header, and must NOT mount the full app shell (Library / Stage /
// Inspector / menubar).

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { getConstants } from "./lib/api";
import CalcOnlyApp from "./CalcOnlyApp";

vi.mock("./lib/api", () => ({
  getConstants: vi.fn(),
}));

describe("CalcOnlyApp", () => {
  it("renders a DiraCulator header and the calculators tab selector", () => {
    vi.mocked(getConstants).mockResolvedValue({ constants: {} });
    render(<CalcOnlyApp />);
    expect(screen.getByText("DiraCulator")).toBeInTheDocument();
    expect(screen.getByLabelText("calculator")).toBeInTheDocument();
  });

  it("does not mount the full app shell (Library/Stage/Inspector/menubar)", () => {
    vi.mocked(getConstants).mockResolvedValue({ constants: {} });
    render(<CalcOnlyApp />);
    // App.tsx's Library+Stage+Inspector row and the menubar are qzk-main /
    // qzk-menubar; CalcOnlyApp never imports those components, so neither
    // class can appear in the DOM.
    expect(document.querySelector(".qzk-main")).toBeNull();
    expect(document.querySelector(".qzk-menubar")).toBeNull();
  });
});
