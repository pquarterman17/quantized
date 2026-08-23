// L0.33 (LIBRARY_WORKBOOK_UX_PLAN PR M) — the Reimport All / Reimport
// Available Sources problem report dialog. Mirrors
// SeparateWorksheetsDialog.test.tsx's rendering conventions.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApp } from "../../store/useApp";
import type { ReimportAllRow } from "../../store/reimportAll";
import ReimportAllDialog from "./ReimportAllDialog";

vi.mock("../../store/toasts", () => ({ toast: vi.fn() }));

const row = (over: Partial<ReimportAllRow>): ReimportAllRow => ({
  datasetId: "d1",
  datasetName: "A.dat",
  sourcePath: "/a",
  outcome: "staged",
  message: "ready",
  ...over,
});

beforeEach(() => {
  useApp.setState({ reimportAllRows: null, reimportAllBusy: false, reimportAllCommitted: null });
});

describe("ReimportAllDialog — visibility", () => {
  it("renders nothing when no report is open and not busy", () => {
    const { container } = render(<ReimportAllDialog />);
    expect(container.firstChild).toBeNull();
  });

  it("shows a staging indicator while busy", () => {
    useApp.setState({ reimportAllBusy: true, reimportAllRows: null });
    render(<ReimportAllDialog />);
    expect(screen.getByText(/staging sources/)).toBeInTheDocument();
  });
});

describe("ReimportAllDialog — problem report", () => {
  it("lists every source with its outcome, naming a failure's specific reason", () => {
    useApp.setState({
      reimportAllRows: [
        row({ datasetId: "d1", datasetName: "A.dat", outcome: "staged" }),
        row({ datasetId: "d2", datasetName: "B.dat", outcome: "missing", message: "source unavailable (/b)" }),
      ],
    });
    render(<ReimportAllDialog />);
    expect(screen.getByText("A.dat")).toBeInTheDocument();
    expect(screen.getByText("B.dat")).toBeInTheDocument();
    expect(screen.getByText(/source unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 sources could not be re-imported/)).toBeInTheDocument();
  });

  it("Close discards the report with zero mutation", () => {
    useApp.setState({ reimportAllRows: [row({ outcome: "missing", message: "gone" })] });
    render(<ReimportAllDialog />);
    fireEvent.click(screen.getByText("Close"));
    expect(useApp.getState().reimportAllRows).toBeNull();
  });

  // Coordinator review G1: Close must route through the real
  // `cancelReimportAll` action (which bumps the generation cell), never a
  // raw `useApp.setState` the view layer could reach for instead — spying
  // on the real action call pins that this component genuinely calls it,
  // rather than merely producing the same visible `reimportAllRows: null`
  // a raw setState would also happen to produce.
  it("Close calls the real cancelReimportAll action, not a raw setState", () => {
    const cancelReimportAll = vi.spyOn(useApp.getState(), "cancelReimportAll");
    useApp.setState({ reimportAllRows: [row({ outcome: "missing", message: "gone" })] });
    render(<ReimportAllDialog />);
    fireEvent.click(screen.getByText("Close"));
    expect(cancelReimportAll).toHaveBeenCalledOnce();
  });

  it("offers \"Reimport Available Sources\" only when something staged cleanly, and it calls commitReimportAll(\"available\")", () => {
    const commitReimportAll = vi.fn().mockResolvedValue(undefined);
    useApp.setState({
      commitReimportAll,
      reimportAllRows: [
        row({ datasetId: "d1", outcome: "staged" }),
        row({ datasetId: "d2", outcome: "missing", message: "gone" }),
      ],
    });
    render(<ReimportAllDialog />);
    const btn = screen.getByText("Reimport Available Sources");
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(commitReimportAll).toHaveBeenCalledWith("available");
  });

  it("disables \"Reimport Available Sources\" with a reason when nothing staged cleanly at all (L0.36: disable, don't remove)", () => {
    useApp.setState({
      reimportAllRows: [row({ outcome: "missing", message: "gone" })],
    });
    render(<ReimportAllDialog />);
    const btn = screen.getByText("Reimport Available Sources");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "no source staged cleanly");
  });

  it("hides the partial-commit button entirely when every source staged cleanly (nothing to report)", () => {
    useApp.setState({ reimportAllRows: [row({ outcome: "staged" })] });
    render(<ReimportAllDialog />);
    expect(screen.queryByText("Reimport Available Sources")).not.toBeInTheDocument();
  });
});

describe("ReimportAllDialog — G2: partial success vs outright refusal banners", () => {
  it("renders the outright-refusal banner when reimportAllCommitted is null", () => {
    useApp.setState({
      reimportAllCommitted: null,
      reimportAllRows: [
        row({ datasetId: "d1", outcome: "missing", message: "gone" }),
        row({ datasetId: "d2", outcome: "parse_error", message: "boom" }),
      ],
    });
    render(<ReimportAllDialog />);
    expect(screen.getByText(/2 of 2 sources could not be re-imported — the workbook was left unchanged/)).toBeInTheDocument();
    expect(screen.queryByText(/^re-imported/)).not.toBeInTheDocument(); // never the partial-success phrasing
  });

  it("renders the partial-success banner when reimportAllCommitted is non-null, never the outright-refusal wording", () => {
    useApp.setState({
      reimportAllCommitted: 3,
      reimportAllRows: [row({ datasetId: "d2", outcome: "parse_error", message: "boom" })],
    });
    render(<ReimportAllDialog />);
    expect(screen.getByText(/re-imported 3 sources; 1 skipped:/)).toBeInTheDocument();
    expect(screen.queryByText(/could not be re-imported/)).not.toBeInTheDocument();
    expect(screen.queryByText(/left unchanged/)).not.toBeInTheDocument();
  });
});
