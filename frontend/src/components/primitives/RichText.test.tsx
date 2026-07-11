import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import RichText from "./RichText";

describe("RichText (HTML renderer)", () => {
  it("renders math runs as <i>/<sub>/<sup>", () => {
    const { container } = render(<RichText text={"$\\mu_0H$ (T)"} />);
    expect(container.querySelector("i")?.textContent).toBe("μ");
    expect(container.querySelector("sub")?.textContent).toBe("0");
    expect(container.textContent).toBe("μ0H (T)");
  });

  it("nests scripts with the 0.7em scale per level", () => {
    const { container } = render(<RichText text={"$x^{a^{b}}$"} />);
    const sup = container.querySelector<HTMLElement>("sup")!;
    expect(sup.style.fontSize).toBe("0.7em");
    expect(sup.querySelector("sup")?.textContent).toBe("b");
  });

  it("renders Greek + symbol commands as Unicode", () => {
    const { container } = render(<RichText text={"$\\Delta\\chi$ at $\\AA^{-1}$"} />);
    expect(container.textContent).toBe("Δχ at Å−1");
  });

  it("passes plain labels through untouched (fast path)", () => {
    const { container } = render(<RichText text="Temperature (K)" />);
    expect(container.textContent).toBe("Temperature (K)");
    expect(container.querySelector("i, sub, sup")).toBeNull();
  });

  it("falls back to the raw string for invalid markup", () => {
    const { container } = render(<RichText text={"$\\foo$"} />);
    expect(container.textContent).toBe("$\\foo$");
    expect(container.querySelector("i, sub, sup")).toBeNull();
  });
});
