import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import EmptyGraphNotice from "./EmptyGraphNotice";

describe("EmptyGraphNotice", () => {
  it("states a given reason", () => {
    render(<EmptyGraphNotice reason="No curves" />);
    expect(screen.getByRole("status")).toHaveTextContent("No curves");
  });
  it("with no reason, says that no row has both an X and a Y (an all-blank X column)", () => {
    render(<EmptyGraphNotice />);
    expect(screen.getByRole("status")).toHaveTextContent("no row has both an X value and a Y value");
  });
});
