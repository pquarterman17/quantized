// UX-A: a Card under a CardStateContext provider is opened from code, reports
// the user's toggle, and scrolls into view on request; without a provider it
// keeps its uncontrolled `defaultOpen` behaviour.

import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Card from "./Card";
import { CardStateContext, type CardStateApi } from "./cardState";

const api = (open: Record<string, boolean>, reveal: CardStateApi["reveal"] = null, setOpen = vi.fn()): CardStateApi => ({
  isOpen: (id, fallback) => open[id] ?? fallback,
  setOpen,
  reveal,
});

describe("Card", () => {
  it("is uncontrolled without a provider", () => {
    const { container } = render(<Card title="Axes" defaultOpen={false}>body</Card>);
    expect(container.querySelector("details")?.open).toBe(false);
    expect(container.querySelector("details")?.hasAttribute("data-card-id")).toBe(false);
  });

  it("opens from code under a provider, by its title or an explicit id", () => {
    const { container, rerender } = render(
      <CardStateContext.Provider value={api({ Axes: true })}>
        <Card title="Axes" defaultOpen={false}>a</Card>
        <Card title={<b>Rich</b>} cardId="rich" defaultOpen={false}>b</Card>
      </CardStateContext.Provider>,
    );
    const [axes, rich] = container.querySelectorAll("details");
    expect(axes?.open).toBe(true);
    expect(rich?.open).toBe(false);
    rerender(
      <CardStateContext.Provider value={api({ Axes: false, rich: true })}>
        <Card title="Axes" defaultOpen={false}>a</Card>
        <Card title={<b>Rich</b>} cardId="rich" defaultOpen={false}>b</Card>
      </CardStateContext.Provider>,
    );
    expect(axes?.open).toBe(false);
    expect(rich?.open).toBe(true);
  });

  it("reports the user's toggle to the provider", () => {
    const setOpen = vi.fn();
    const { container } = render(
      <CardStateContext.Provider value={api({}, null, setOpen)}>
        <Card title="Notes" defaultOpen={false}>n</Card>
      </CardStateContext.Provider>,
    );
    const details = container.querySelector("details")!;
    act(() => {
      details.open = true;
      fireEvent(details, new Event("toggle"));
    });
    expect(setOpen).toHaveBeenCalledWith("Notes", true);
  });

  it("scrolls into view when revealed", () => {
    const scroll = vi.fn();
    const proto = HTMLElement.prototype as unknown as { scrollIntoView?: unknown };
    const before = proto.scrollIntoView;
    proto.scrollIntoView = scroll;
    try {
      render(
        <CardStateContext.Provider value={api({}, { id: "Shapes", n: 1 })}>
          <Card title="Notes">n</Card>
          <Card title="Shapes">s</Card>
        </CardStateContext.Provider>,
      );
      expect(scroll).toHaveBeenCalledTimes(1);
    } finally {
      proto.scrollIntoView = before;
    }
  });
});
