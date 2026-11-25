import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useRevealResult } from "./useRevealResult";

function Probe({ result }: { result: unknown }) {
  const ref = useRevealResult(result);
  return <div ref={ref} data-testid="r" />;
}

describe("useRevealResult (UX audit P2-9)", () => {
  it("scrolls the wrapper into view when a result appears or changes, not when there is none", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { rerender } = render(<Probe result={null} />);
    expect(scroll).not.toHaveBeenCalled();
    rerender(<Probe result={{ a: 1 }} />);
    expect(scroll).toHaveBeenCalledTimes(1);
    rerender(<Probe result={{ a: 2 }} />);
    expect(scroll).toHaveBeenCalledTimes(2);
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
});
