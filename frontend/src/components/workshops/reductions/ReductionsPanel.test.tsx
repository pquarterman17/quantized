// View smoke tests + the Analyze-menu command-registry checks (source-scan
// pattern, same as TextFormatHelp.test.tsx — the App tree is too heavy to
// render in jsdom).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import ReductionsPanel from "./ReductionsPanel";

const scan: DataStruct = {
  time: [10, 20, 30],
  values: [[1], [2], [3]],
  labels: ["Intensity"],
  units: ["cps"],
  metadata: {},
};

beforeEach(() => {
  useApp.setState({
    datasets: [],
    activeId: null,
    reductionsOpen: true,
    reductionsMethod: "williamson-hall",
  });
});

describe("ReductionsPanel", () => {
  it("opens on the Williamson-Hall method by default and shows its peak table", () => {
    render(<ReductionsPanel />);
    expect(screen.getByText("Method")).toBeInTheDocument();
    expect(screen.getByText("2θ (°)")).toBeInTheDocument();
    expect(screen.getByText("FWHM (°)")).toBeInTheDocument();
  });

  it("shows the FFT-thickness section's no-dataset hint when preset to that method", () => {
    useApp.getState().setReductionsMethod("fft-thickness");
    render(<ReductionsPanel />);
    expect(screen.getByText(/Select an XRD dataset/)).toBeInTheDocument();
  });

  it("shows the reflectivity-FFT section once a dataset is active", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "xrr.dat", data: scan }], activeId: "d1" });
    useApp.getState().setReductionsMethod("reflectivity-fft");
    render(<ReductionsPanel />);
    expect(screen.getByText("Reflectivity channel")).toBeInTheDocument();
  });

  it("switching the method picker swaps the visible section", () => {
    render(<ReductionsPanel />);
    const select = screen.getByDisplayValue("Williamson-Hall (size + strain)");
    fireEvent.change(select, { target: { value: "fft-thickness" } });
    expect(useApp.getState().reductionsMethod).toBe("fft-thickness");
    expect(screen.getByText(/Select an XRD dataset/)).toBeInTheDocument();
  });

  it("closes via the ToolWindow close button", () => {
    render(<ReductionsPanel />);
    screen.getByTitle("Close").click();
    expect(useApp.getState().reductionsOpen).toBe(false);
  });
});

describe("Analyze-menu command registry entries (MAIN_PLAN #11)", () => {
  const commandsSrc = Object.values(
    import.meta.glob("../../../appCommands.ts", { query: "?raw", import: "default", eager: true }),
  )[0] as string;
  const overlaysSrc = Object.values(
    import.meta.glob("../../../AppOverlays.tsx", { query: "?raw", import: "default", eager: true }),
  )[0] as string;

  it("registers Williamson-Hall in the Analyze group", () => {
    expect(commandsSrc).toContain('id: "reductions-wh"');
    expect(commandsSrc).toContain('group: "Analyze"');
    expect(commandsSrc).toContain('openReductions("williamson-hall")');
  });

  it("registers Film thickness (FFT) in the Analyze group", () => {
    expect(commandsSrc).toContain('id: "reductions-fft"');
    expect(commandsSrc).toContain('openReductions("fft-thickness")');
  });

  it("registers Reflectivity FFT in the Analyze group", () => {
    expect(commandsSrc).toContain('id: "reductions-reflfft"');
    expect(commandsSrc).toContain('openReductions("reflectivity-fft")');
  });

  it("AppOverlays.tsx mounts the panel behind reductionsOpen", () => {
    expect(overlaysSrc).toContain("<ReductionsPanel />");
    expect(overlaysSrc).toContain("reductionsOpen");
  });
});
