// Pack Project — sources flagged as needing attention (security hardening,
// 2026-10-01). An untrusted .dwk can declare any path as a source; the
// backend preview flags a packable source outside the data folders or of an
// unrecognised type. The panel lists each with a short reason, leaves them
// OUT by default, and packs them only behind an explicit checkbox.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PortableManifest, PortableSourceRow } from "../../../lib/desktopPackBridge";
import { EMPTY_PACK_PROGRESS, usePackProject } from "../../../store/packProject";
import { usePackProjectPanel } from "../../../store/packProjectPanel";
import PackProjectPanel from "./PackProjectPanel";

vi.mock("../../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

const fakeAppState = {
  toolWindowLayout: {},
  setToolWindowLayout: vi.fn(),
  toggleToolWindowCollapsed: vi.fn(),
};
function useAppMock<T>(selector: (s: typeof fakeAppState) => T): T {
  return selector(fakeAppState);
}
useAppMock.getState = () => fakeAppState;
vi.mock("../../../store/useApp", () => ({ useApp: useAppMock }));

function row(id: string, path: string, attention: PortableSourceRow["attention"] = []): PortableSourceRow {
  return {
    source_id: id,
    original_path: path,
    original_path_variants: [],
    bundle_path: `sources/${path.split("/").pop()}`,
    status: "ok",
    size: 10,
    mtime: null,
    checksum: null,
    shared: false,
    shared_by: [],
    changed: false,
    unverified: false,
    packable: true,
    blockers: [],
    warnings: [],
    collision_group: null,
    renamed_from: null,
    attention,
  };
}

function manifest(sources: PortableSourceRow[]): PortableManifest {
  return {
    format: "quantized-portable",
    manifest_version: 1,
    dry_run: true,
    project: { name: "demo", project_file: "demo.dwk", workspace_format: null, workspace_version: null, renamed_from: null },
    layout: { manifest_file: "manifest.json", sources_dir: "sources" },
    sources,
    datasets: [],
    warnings: [],
    summary: { datasets: 1, sources: sources.length, packable: sources.length, blocked: 0, shared: 0, total_bytes: 30, warnings: 0 },
  };
}

function seed(m: PortableManifest, start = vi.fn()) {
  usePackProject.setState({
    phase: "awaiting_confirmation",
    progress: EMPTY_PACK_PROGRESS,
    preview: {
      token: "t1",
      manifest: m,
      destination: { bundleDir: "/dest/demo", exists: false },
      warnings: [],
      blockers: [],
      content: "{}",
      destinationParent: "/dest",
      projectName: "demo",
    },
    startPackProject: start,
  });
  return start;
}

const flagged = manifest([
  row("s1", "/data/run.csv"),
  row("s2", "/home/u/.ssh/id_rsa", [
    { code: "outside_data_roots", reason: "outside your data folders" },
    { code: "unrecognised_extension", reason: "not a recognised data file type" },
  ]),
]);

beforeEach(() => {
  usePackProjectPanel.setState({ open: true });
});

describe("PackProjectPanel — flagged sources", () => {
  it("lists each flagged file with its reasons and a one-sentence default note", () => {
    seed(flagged);
    render(<PackProjectPanel />);
    const section = screen.getByRole("region", { name: "Flagged files" });
    expect(section).toHaveTextContent("id_rsa");
    expect(section).toHaveTextContent("outside your data folders; not a recognised data file type");
    expect(section).toHaveTextContent("Flagged files are left out of the bundle unless you include them.");
    expect(section).not.toHaveTextContent("run.csv");
    expect(screen.getByRole("checkbox", { name: "Include flagged files" })).not.toBeChecked();
  });

  it("packs WITHOUT the flagged files by default", async () => {
    const start = seed(flagged);
    render(<PackProjectPanel />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pack Project" }));
    });
    expect(start).toHaveBeenCalledWith(flagged, false);
  });

  it("packs the flagged files only after the explicit confirm", async () => {
    const start = seed(flagged);
    render(<PackProjectPanel />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Include flagged files" }));
    expect(screen.getByRole("checkbox", { name: "Include flagged files" })).toBeChecked();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pack Project" }));
    });
    expect(start).toHaveBeenCalledWith(flagged, true);
  });

  it("shows no flagged section or checkbox when nothing is flagged", () => {
    seed(manifest([row("s1", "/data/run.csv")]));
    render(<PackProjectPanel />);
    expect(screen.queryByRole("region", { name: "Flagged files" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Include flagged files" })).toBeNull();
  });
});
