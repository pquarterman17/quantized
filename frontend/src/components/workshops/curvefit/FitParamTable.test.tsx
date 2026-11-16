// UX audit 8 #5: in the docked Inspector at 1280-1440 px Curve Fit's "95 % CI"
// column was clipped behind a sideways scroll. When the one-line table is
// wider than its box the CI folds under "Value ± SE". jsdom has no layout, so
// the box's widths are set by hand here; the real-browser check at 1280×720
// is e2e/specs/fit-peak-defaults.spec.ts.

import { act, render, screen } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import FitParamTable from "./FitParamTable";

const columns = ["Parameter", "Value ± SE", "95 % CI"];
const rows = [
  ["A", "(5.94 ± 0.30)×10⁻⁴", "[5.33, 6.55]×10⁻⁴"],
  ["γ", "336 ± 12", "—"],
];

let widths = { scroll: 200, client: 300 };
const proto = HTMLElement.prototype;
const saved = {
  scroll: Object.getOwnPropertyDescriptor(proto, "scrollWidth"),
  client: Object.getOwnPropertyDescriptor(proto, "clientWidth"),
};
Object.defineProperty(proto, "scrollWidth", { configurable: true, get: () => widths.scroll });
Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => widths.client });
afterEach(() => {
  widths = { scroll: 200, client: 300 };
});
afterAll(() => {
  for (const [k, d] of [["scrollWidth", saved.scroll], ["clientWidth", saved.client]] as const) {
    if (d) Object.defineProperty(proto, k, d);
    else Reflect.deleteProperty(proto, k); // jsdom defines them on Element.prototype
  }
});

const headers = () => screen.getAllByRole("columnheader").map((h) => h.textContent);

describe("FitParamTable", () => {
  it("keeps one line per value and per CI when the box is wide enough", () => {
    render(<FitParamTable columns={columns} rows={rows} />);
    expect(headers()).toEqual(columns);
    expect(screen.getByRole("cell", { name: "[5.33, 6.55]×10⁻⁴" })).toBeTruthy();
  });

  it("folds the CI under the value when the table overflows its box", () => {
    widths = { scroll: 420, client: 300 };
    const { container } = render(<FitParamTable columns={columns} rows={rows} />);
    expect(container.querySelector("[data-ci-stacked]")).not.toBeNull();
    expect(headers()).toEqual(["Parameter", "Value ± SE95 % CI"]);
    const cell = screen.getAllByRole("cell")[1]!;
    expect(cell.textContent).toBe("(5.94 ± 0.30)×10⁻⁴[5.33, 6.55]×10⁻⁴");
    // A parameter without a CI shows its value alone, no dash line.
    expect(screen.getAllByRole("cell")[3]!.textContent).toBe("336 ± 12");
  });

  it("goes back to one line once the box is as wide as the one-line table", () => {
    widths = { scroll: 420, client: 300 };
    const ro: { cb: (() => void) | null } = { cb: null };
    const RO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        ro.cb = cb;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    try {
      const { container } = render(<FitParamTable columns={columns} rows={rows} />);
      expect(container.querySelector("[data-ci-stacked]")).not.toBeNull();
      widths = { scroll: 300, client: 430 };
      act(() => ro.cb!());
      expect(container.querySelector("[data-ci-stacked]")).toBeNull();
      expect(headers()).toEqual(columns);
    } finally {
      globalThis.ResizeObserver = RO;
    }
  });
});
