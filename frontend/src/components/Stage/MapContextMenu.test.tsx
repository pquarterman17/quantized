// UX menus audit M4: the map's right-click menu (no native browser menu).

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import MapContextMenu, { type MapMenuProps } from "./MapContextMenu";
import { useMapContextMenu } from "./useMapContextMenu";

const props = (extra: Partial<MapMenuProps> = {}): MapMenuProps => ({
  x: 10, y: 10, datasetId: "ds", canvas: null, cmap: "viridis", logZ: false, contourOn: false,
  hasColorLimits: false, cutSpace: "angular", onExport: vi.fn(), onClose: vi.fn(), ...extra,
});

describe("MapContextMenu", () => {
  it("lists the map tools with a reason on each disabled one", () => {
    render(<MapContextMenu {...props({ cutSpace: null })} />);
    for (const name of ["Map operations…", "ROI cuts…", "Color map", "Log color scale", "Contour lines", "Reset color range", "Copy figure", "Export figure…"]) {
      expect(screen.getByText(new RegExp(name))).toBeInTheDocument();
    }
    expect(screen.getByRole("menuitem", { name: /ROI cuts/ })).toHaveAttribute("title", expect.stringContaining("2-D map"));
    expect(screen.getByRole("menuitem", { name: /Reset color range/ })).toHaveAttribute("title", expect.stringContaining("automatic"));
  });

  it("Export figure runs the vector export", () => {
    const onExport = vi.fn();
    render(<MapContextMenu {...props({ onExport })} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Export figure…" }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});

function Host() {
  const m = useMapContextMenu({ datasetId: "ds", canvas: null, cmap: "viridis", logZ: false, contourOn: false, hasColorLimits: false, cutSpace: null, onExport: () => {} });
  return <div data-testid="stage" onContextMenu={m.onContextMenu}>{m.node}<span>map</span><select aria-label="sel" /></div>;
}

describe("useMapContextMenu", () => {
  it("default-prevents the browser menu on the map and opens ours", async () => {
    render(<Host />);
    expect(fireEvent.contextMenu(screen.getByText("map"))).toBe(false);
    expect(await screen.findByRole("menuitem", { name: "Export figure…" })).toBeInTheDocument();
  });

  it("keeps the native menu on a toolbar select", () => {
    render(<Host />);
    expect(fireEvent.contextMenu(screen.getByLabelText("sel"))).toBe(true);
  });
});
