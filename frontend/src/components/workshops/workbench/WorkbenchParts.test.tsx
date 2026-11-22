// Shared workbench shell (lane WB): the display parts.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PROVISIONAL_LABEL, WorkbenchActions, WorkbenchMessage, WorkbenchPreviewFrame, WorkbenchProgress } from "./WorkbenchParts";

describe("WorkbenchPreviewFrame", () => {
  it("marks its content provisional ('not saved')", () => {
    render(<WorkbenchPreviewFrame><p>curve</p></WorkbenchPreviewFrame>);
    const frame = screen.getByRole("region", { name: PROVISIONAL_LABEL });
    expect(frame).toHaveAttribute("data-provisional", "true");
    expect(frame).toHaveTextContent("Preview (not saved)");
    expect(frame).toHaveTextContent("curve");
  });

  it("says when it is loading, and when it is out of date", () => {
    const { rerender } = render(<WorkbenchPreviewFrame loading />);
    expect(screen.getByText("Previewing…")).toBeInTheDocument();
    rerender(<WorkbenchPreviewFrame stale />);
    expect(screen.getByText(/Out of date/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: PROVISIONAL_LABEL })).toHaveAttribute("data-stale", "true");
  });
});

describe("WorkbenchMessage", () => {
  it("renders nothing without a message", () => {
    const { container } = render(<WorkbenchMessage refusal="" error={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("a refusal wins over an error, and each says which it is", () => {
    const { rerender } = render(<WorkbenchMessage refusal="Select a dataset first." error="backend down" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Select a dataset first.");
    expect(screen.getByRole("alert")).toHaveAttribute("data-kind", "refusal");
    rerender(<WorkbenchMessage error="backend down" />);
    expect(screen.getByRole("alert")).toHaveTextContent("backend down");
    expect(screen.getByRole("alert")).toHaveAttribute("data-kind", "error");
  });
});

describe("WorkbenchActions", () => {
  it("a disabled commit says why; Cancel and extra buttons are offered", () => {
    const onCancel = vi.fn();
    const onCommit = vi.fn();
    render(
      <WorkbenchActions onCancel={onCancel} commitLabel="Create" busyLabel="Creating…" busy={false} disabledReason="Waiting for the live preview…" onCommit={onCommit}>
        <button type="button">Save recipe…</button>
      </WorkbenchActions>,
    );
    const commit = screen.getByRole("button", { name: "Create" });
    expect(commit).toBeDisabled();
    expect(commit).toHaveAttribute("title", "Waiting for the live preview…");
    expect(screen.getByRole("button", { name: "Save recipe…" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("is disabled with the busy label while committing, enabled otherwise", () => {
    const onCommit = vi.fn();
    const { rerender } = render(<WorkbenchActions commitLabel="Create" busyLabel="Creating…" busy disabledReason={null} onCommit={onCommit} />);
    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
    rerender(<WorkbenchActions commitLabel="Create" busyLabel="Creating…" busy={false} disabledReason={null} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });
});

describe("WorkbenchProgress", () => {
  it("is determinate for a counted batch, with Stop", () => {
    const onStop = vi.fn();
    render(<WorkbenchProgress progress={{ done: 2, total: 5, current: "b.dat" }} label="Batch" onStop={onStop} />);
    const bar = screen.getByRole("progressbar", { name: "Batch" });
    expect(bar).toHaveAttribute("value", "2");
    expect(bar).toHaveAttribute("max", "5");
    expect(screen.getByText(/2\/5 — b\.dat/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop after current" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("is determinate for a backend fraction and indeterminate only without one", () => {
    const { rerender } = render(<WorkbenchProgress progress={{ fraction: 0.25, message: "fitting" }} label="Job" />);
    expect(screen.getByRole("progressbar", { name: "Job" })).toHaveAttribute("value", "0.25");
    expect(screen.getByText("25% fitting")).toBeInTheDocument();
    rerender(<WorkbenchProgress progress={{ fraction: null }} label="Job" />);
    expect(screen.getByRole("progressbar", { name: "Job" })).not.toHaveAttribute("value");
  });

  it("clamps an out-of-range fraction and shows NaN as indeterminate", () => {
    const { rerender } = render(<WorkbenchProgress progress={{ fraction: 1.7, message: "x" }} label="Job" />);
    expect(screen.getByRole("progressbar", { name: "Job" })).toHaveAttribute("value", "1");
    expect(screen.getByText("100% x")).toBeInTheDocument();
    rerender(<WorkbenchProgress progress={{ fraction: Number.NaN, message: "x" }} label="Job" />);
    expect(screen.getByRole("progressbar", { name: "Job" })).not.toHaveAttribute("value");
    expect(screen.getByText("x")).toBeInTheDocument();
  });

  it("renders nothing without progress", () => {
    const { container } = render(<WorkbenchProgress progress={null} label="Job" />);
    expect(container).toBeEmptyDOMElement();
  });
});
