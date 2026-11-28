// U4 (acceptance pass 13): a minimized window keeps its share in the layout but is not drawn. The window left
// in its slot must fill the slot, not just the fraction its own share was of the pair.
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WindowLayoutV1 } from "../../../lib/windowLayout/types";
import DockRegion from "./DockRegion";

vi.mock("./LayoutWindowFrame", () => ({ default: ({ refId }: { refId: string }) => <div data-testid={refId} /> }));

const layout = (shares: Record<string, number>): WindowLayoutV1 => ({
  placements: Object.fromEntries(Object.entries(shares).map(([r, share]) => [r, { open: true, slot: "centre", share }])),
  z: Object.keys(shares), centre: "row",
}) as unknown as WindowLayoutV1;
const grows = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>(".qzk-wl-cell")].map((e) => parseFloat(e.style.flexGrow));

describe("DockRegion shares", () => {
  it("a lone window whose share was half of the slot fills all of it", () => {
    const { container } = render(<DockRegion slot="centre" refs={["plot:a"]} layout={layout({ "plot:p": 0.5, "plot:a": 0.5 })} titleOf={(r) => r} />);
    expect(grows(container)).toEqual([1]);
  });

  it("two windows keep their proportions and still sum to one", () => {
    const { container } = render(<DockRegion slot="centre" refs={["plot:p", "plot:a"]} layout={layout({ "plot:p": 0.25, "plot:a": 0.75 })} titleOf={(r) => r} />);
    expect(grows(container)).toEqual([0.25, 0.75]);
  });
});
