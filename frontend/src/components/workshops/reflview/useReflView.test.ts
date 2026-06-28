import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useReflView } from "./useReflView";

const refl: DataStruct = {
  time: [0.01, 0.02],
  values: [
    [7e-4, 0.99, 7e-3, 1.05, 0.12],
    [7e-4, 1.0, 7e-3, 1.04, 0.1],
  ],
  labels: ["dQ", "R", "dR", "theory", "fresnel"],
  units: ["1/A", "", "", "", ""],
  metadata: { x_column_name: "Q", x_column_unit: "1/A" },
};
const profile: DataStruct = {
  time: [-10, -9.9],
  values: [[20, 0.74], [20, 0.74]],
  labels: ["rho", "irho"],
  units: ["1e-6/A2", "1e-6/A2"],
  metadata: { x_column_name: "z", x_column_unit: "A" },
};

beforeEach(() => {
  useApp.setState({
    datasets: [
      { id: "r", name: "NbAl_XRR-refl.dat", data: refl },
      { id: "p", name: "NbAl_XRR-profile.dat", data: profile },
    ],
    activeId: "r",
  });
});

describe("useReflView", () => {
  it("auto-pairs the refl + profile and builds both frames", () => {
    const { result } = renderHook(() => useReflView());
    expect(result.current.reflId).toBe("r");
    expect(result.current.profileId).toBe("p");
    expect(result.current.panels.top?.series.map((s) => s.label)).toEqual(["R", "theory", "fresnel"]);
    expect(result.current.panels.bottom?.series.map((s) => s.label)).toEqual(["rho", "irho"]);
    expect(result.current.logY).toBe(true); // reflectivity defaults to log
  });

  it("offers only matching datasets in each picker", () => {
    const { result } = renderHook(() => useReflView());
    expect(result.current.reflOptions.map((o) => o.id)).toEqual(["r"]);
    expect(result.current.profileOptions.map((o) => o.id)).toEqual(["p"]);
  });

  it("clearing a picker drops that frame", () => {
    const { result } = renderHook(() => useReflView());
    act(() => result.current.setProfileId(""));
    expect(result.current.panels.bottom).toBeNull();
    expect(result.current.panels.top).not.toBeNull();
  });
});
