// The map card's opt-in Shepard and kriging options: shown only for those
// methods, validated before they are applied, and carried (for that method only)
// in the /api/plot/map request the map stage makes. Nothing set = nothing sent.

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getMapGridOpts, gridRequestFields, setMapGridOpts } from "../../lib/mapGridOpts";
import { fetchMap } from "../../lib/mapdataFetch";
import { useApp } from "../../store/useApp";
import MapCard from "./MapCard";

const ds = { time: [0, 1, 2], values: [[0, 1], [1, 2], [2, 3]], labels: ["Y", "Z"], units: ["", ""], metadata: {} };

beforeEach(() => {
  setMapGridOpts({ shepNeighbors: undefined, shepRadius: undefined, shepQuadratic: undefined, variogram: undefined, krigeNeighbors: undefined });
  useApp.setState({ mapMethod: "linear", mapRes: 200 });
});
afterEach(() => vi.unstubAllGlobals());

describe("MapCard Shepard / kriging options", () => {
  it("shows no option fields for the other methods", () => {
    render(<MapCard />);
    expect(screen.queryByLabelText("Shepard neighbours")).toBeNull();
    expect(screen.queryByLabelText("Variogram model")).toBeNull();
  });

  it("Shepard: applies valid values on blur, refuses bad ones with the reason and keeps the last good", async () => {
    useApp.setState({ mapMethod: "shepard" });
    render(<MapCard />);
    const nb = await screen.findByLabelText("Shepard neighbours");
    fireEvent.change(nb, { target: { value: "12" } });
    fireEvent.blur(nb);
    expect(getMapGridOpts().shepNeighbors).toBe(12);
    fireEvent.change(nb, { target: { value: "2" } });
    fireEvent.blur(nb);
    expect(screen.getByRole("alert")).toHaveTextContent(/3 to 200/);
    expect(getMapGridOpts().shepNeighbors).toBe(12);
    const radius = screen.getByLabelText("Shepard radius");
    fireEvent.change(radius, { target: { value: "2.5" } });
    fireEvent.blur(radius);
    expect(getMapGridOpts().shepRadius).toBeUndefined();
    fireEvent.change(radius, { target: { value: "0.4" } });
    fireEvent.blur(radius);
    expect(getMapGridOpts().shepRadius).toBe(0.4);
    fireEvent.click(screen.getByLabelText("Quadratic nodal functions"));
    expect(getMapGridOpts().shepQuadratic).toBe(false);
    // Blank goes back to the route's default.
    fireEvent.change(nb, { target: { value: "" } });
    fireEvent.blur(nb);
    expect(getMapGridOpts().shepNeighbors).toBeUndefined();
  });

  it("kriging: the variogram and neighbours are set, and a bad count is refused", async () => {
    useApp.setState({ mapMethod: "kriging" });
    render(<MapCard />);
    fireEvent.change(await screen.findByLabelText("Variogram model"), { target: { value: "spherical" } });
    expect(getMapGridOpts().variogram).toBe("spherical");
    fireEvent.change(screen.getByLabelText("Variogram model"), { target: { value: "auto" } });
    expect(getMapGridOpts().variogram).toBeUndefined();
    const kn = screen.getByLabelText("Kriging neighbours");
    fireEvent.change(kn, { target: { value: "3" } });
    fireEvent.blur(kn);
    expect(getMapGridOpts().krigeNeighbors).toBeUndefined();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.change(kn, { target: { value: "16" } });
    fireEvent.blur(kn);
    expect(getMapGridOpts().krigeNeighbors).toBe(16);
  });
});

describe("the request", () => {
  const bodyOf = async (method: string): Promise<Record<string, unknown>> => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal("fetch", (_u: string, init: { body: string }) => {
      body = JSON.parse(init.body);
      return Promise.reject(new Error("offline"));
    });
    await fetchMap(ds, 0, 1, 2, { method, nx: 10, ny: 10, grid: getMapGridOpts() });
    return body;
  };

  it("sends only the active method's options, and none when none are set", async () => {
    setMapGridOpts({ shepNeighbors: 9, krigeNeighbors: 20, variogram: "gaussian" });
    expect(gridRequestFields("shepard", getMapGridOpts())).toEqual({ shepard_neighbors: 9 });
    expect(gridRequestFields("kriging", getMapGridOpts())).toEqual({ variogram: "gaussian", krige_neighbors: 20 });
    expect(gridRequestFields("linear", getMapGridOpts())).toEqual({});
    const b = await bodyOf("kriging");
    expect(b).toMatchObject({ method: "kriging", variogram: "gaussian", krige_neighbors: 20 });
    expect(b).not.toHaveProperty("shepard_neighbors");
    setMapGridOpts({ shepNeighbors: undefined, krigeNeighbors: undefined, variogram: undefined });
    const none = await bodyOf("kriging");
    expect(none).not.toHaveProperty("variogram");
    expect(none).not.toHaveProperty("krige_neighbors");
  });
});
