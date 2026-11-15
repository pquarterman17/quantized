import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import MapInterpolatedBadge from "./MapInterpolatedBadge";

describe("MapInterpolatedBadge", () => {
  it("says the map is interpolated and from how many points", () => {
    render(<MapInterpolatedBadge nPoints={60} />);
    expect(screen.getByRole("note").textContent).toBe("Interpolated from 60 scattered points");
  });
});
