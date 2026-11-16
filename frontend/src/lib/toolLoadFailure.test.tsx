// UX audit 8 #9: a failed tool panel's card names no component, says
// "(server unreachable)" only after a real connection was lost (reactively),
// stacks with other failed cards, and can be put away.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetConnectionSeenForTests } from "./connectionSeen";
import { useConnection } from "./lifecycle";
import ToolLoadFailure from "./toolLoadFailure";

const setConnected = (connected: boolean) => act(() => useConnection.setState({ connected }));

beforeEach(() => {
  useConnection.setState({ connected: false, stale: null });
  resetConnectionSeenForTests();
});
afterEach(() => document.querySelector(".qzk-lazy-fail-stack")?.remove());

describe("ToolLoadFailure", () => {
  it("never claims the server is unreachable on a page that never connected", () => {
    render(<ToolLoadFailure label="CurveFitPanel" onRetry={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("⚠ This tool couldn't load.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("CurveFitPanel");
    expect(screen.getByRole("alert")).toHaveAttribute("title", "CurveFitPanel");
  });

  it("adds '(server unreachable)' once a live connection drops, and removes it on reconnect", () => {
    setConnected(true);
    setConnected(false);
    render(<ToolLoadFailure label="CurveFitPanel" onRetry={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("This tool couldn't load (server unreachable).");
    setConnected(true);
    expect(screen.getByRole("alert")).toHaveTextContent("This tool couldn't load.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("unreachable");
  });

  it("calls a dialog a dialog", () => {
    render(<ToolLoadFailure label="PreferencesDialog" onRetry={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("This dialog couldn't load.");
  });

  it("stacks two failed cards in one column, and × puts one away", () => {
    render(
      <>
        <ToolLoadFailure label="CurveFitPanel" onRetry={vi.fn()} />
        <ToolLoadFailure label="PeaksPanel" onRetry={vi.fn()} />
      </>,
    );
    const cards = screen.getAllByRole("alert");
    expect(cards).toHaveLength(2);
    expect(cards[0].parentElement).toBe(cards[1].parentElement);
    expect(cards[0].parentElement).toHaveClass("qzk-lazy-fail-stack");
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("Retry asks again", () => {
    const onRetry = vi.fn();
    render(<ToolLoadFailure label="CurveFitPanel" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
