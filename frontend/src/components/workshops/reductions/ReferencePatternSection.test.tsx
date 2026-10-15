import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "../../../store/useApp";
import ReferencePatternSection from "./ReferencePatternSection";

const data = {
  time: [20, 30, 40],
  values: [[100], [200], [150]],
  labels: ["Intensity"],
  units: ["cps"],
  metadata: { x_column_name: "2-Theta", x_column_unit: "deg", wavelength_a: 1.5406 },
};

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "xrd", name: "scan.xrdml", data }],
    activeId: "xrd", xKey: null, refLines: [], history: [], future: [], status: "",
  });
});

describe("ReferencePatternSection", () => {
  it("previews a file and adds one undoable, persisted stick group", async () => {
    const { container } = render(<ReferencePatternSection />);
    const file = new File([
      "# wavelength = 1.5406\n2theta,intensity,hkl\n28.44,100,(111)\n32.96,50,(200)\n",
    ], "silicon.csv", { type: "text/csv" });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await screen.findByDisplayValue("silicon");
    expect(screen.getByText("28.4400")).toBeInTheDocument();
    const add = screen.getByRole("button", { name: /Add 2 reference sticks/ });
    fireEvent.click(add);
    fireEvent.click(add); // stale double-click event must not append twice

    const lines = useApp.getState().refLines;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      axis: "x", value: 28.44, label: "(111)", groupLabel: "silicon · λ 1.54060 Å",
      stick: { intensity: 1, baseline: 0.03, height: 0.18, visible: true, showLabel: false },
    });
    expect(lines[1].groupId).toBe(lines[0].groupId);
    expect(useApp.getState().history).toHaveLength(1);
    expect(useApp.getState().status).toContain("added 2 reference sticks");
    expect(screen.queryByRole("button", { name: /Add 2 reference sticks/ })).not.toBeInTheDocument();
  });

  it("does not add a reference to an incompatible active axis", async () => {
    useApp.setState({ datasets: [{ id: "q", name: "rsm.dat", data: { ...data, metadata: { x_column_name: "Qz", x_column_unit: "1/Ang" } } }], activeId: "q" });
    const { container } = render(<ReferencePatternSection />);
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["20 100\n"], "phase.xy")] } });
    await waitFor(() => expect(screen.getByRole("button", { name: /Add 1 reference stick/ })).toBeDisabled());
    expect(screen.getByText(/not 2θ in degrees/)).toBeInTheDocument();
  });
});
