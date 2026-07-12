import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BumpsPosterior } from "../../../lib/fitbumps";
import DreamConvergence from "./DreamConvergence";

const base: BumpsPosterior = {
  medians: [1, 2],
  interval68: [
    [0.9, 1.1],
    [1.8, 2.2],
  ],
  n_draws: 1500,
};

describe("DreamConvergence", () => {
  it("renders nothing without diagnostics (legacy payload / non-DREAM)", () => {
    const { container } = render(<DreamConvergence posterior={base} />);
    expect(container).toBeEmptyDOMElement();
    expect(render(<DreamConvergence posterior={undefined} />).container).toBeEmptyDOMElement();
  });

  it("shows the R-hat diagnostics table when converged, with no alert", () => {
    render(
      <DreamConvergence
        posterior={{ ...base, rHatMax: 1.02, converged: true, nChains: 16 }}
      />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("R-hat (max)")).toBeInTheDocument();
    expect(screen.getByText("chains")).toBeInTheDocument();
  });

  it("warns (role=alert) when the chains did not converge", () => {
    render(
      <DreamConvergence
        posterior={{ ...base, rHatMax: 1.42, converged: false, nChains: 16 }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("did not converge");
  });
});
