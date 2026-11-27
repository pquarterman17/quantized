// The Publication Preview exports the revision it previews, says which one, and
// says so when the preview moves to a newer plot. Policy when the plot changes
// while the preview is open:
//  - no edits of its own in the preview: the preview REFRESHES onto the live plot
//    (store/publicationRebase) with a notice naming the new revision;
//  - edits of its own: nothing is merged, Export is off with the reason (existing
//    behaviour, pinned in exportSession.test.ts).
// A click on Export pins the revision shown at that moment; the file and the
// confirmation carry that revision even if the plot moves while the file renders.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigure, type FigureSpec } from "../../../lib/api/figures";
import { createFigureDocument, type FigureDocument } from "../../../lib/figureDocument";
import { figureRevision } from "../../../lib/figureRevision";
import { defaultPlotView } from "../../../lib/plotview";
import { rebaseFigurePublicationOnLive } from "../../../store/publicationRebase";
import { useToasts } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { exportPreviewFigure, type PreviewExportDeps } from "./previewExport";

const live = vi.hoisted(() => ({ doc: null as unknown }));
vi.mock("../../../store/liveWindowDocument", () => ({ liveWindowDocument: () => live.doc }));
vi.mock("../../../lib/api/figures", () => ({ exportFigure: vi.fn() }));

const doc = (title: string): FigureDocument =>
  createFigureDocument({ id: "f1", name: "Fig", datasetId: "d1", view: { ...defaultPlotView(), plotTitle: title } });
const DATA = { time: [0, 1], values: [[1], [2]], labels: ["A"], units: [""], metadata: {} };

function deps(document: FigureDocument, statuses: string[]): PreviewExportDeps {
  return {
    canonicalDocument: document,
    canonicalReadiness: { state: "ready", data: DATA, spec: { fmt: "pdf" } as unknown as FigureSpec } as never,
    canonicalDataset: { id: "d1", name: "scan.dat", data: DATA },
    spec: null, legacyState: {} as never, frozenData: null, active: null, fmt: "pdf", dpi: 300,
    autoSeriesStyles: false, setStatus: (s) => statuses.push(s),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(exportFigure).mockResolvedValue(undefined as never);
  useToasts.setState({ toasts: [] });
  useApp.setState({ plotWindows: [{ id: "w1" }] as never, focusedWindowId: "w1", status: "" });
});

describe("export names the revision it wrote", () => {
  it("the confirmation carries the revision of the document that was exported", async () => {
    const shown = doc("As previewed");
    const statuses: string[] = [];
    await exportPreviewFigure(deps(shown, statuses));
    expect(statuses.at(-1)).toContain(`revision ${figureRevision(shown)}`);
    expect(statuses.at(-1)).toMatch(/^exported scan\.pdf/);
  });

  it("a plot change while the file renders does not change what was exported or what is reported", async () => {
    const shown = doc("As previewed");
    const statuses: string[] = [];
    let release!: () => void;
    vi.mocked(exportFigure).mockImplementationOnce(() => new Promise<never>((res) => { release = () => res(undefined as never); }));
    const pending = exportPreviewFigure(deps(shown, statuses));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    // The user edits the plot on Stage while the render is in flight.
    live.doc = doc("Edited meanwhile");
    useApp.setState({ figurePublicationSession: { target: "window", windowId: "w1", baseline: shown, draft: shown } });
    release();
    await pending;
    expect(statuses.at(-1)).toContain(`revision ${figureRevision(shown)}`);
    expect(statuses.at(-1)).not.toContain(figureRevision(doc("Edited meanwhile")));
  });
});

describe("a preview that follows the plot says so", () => {
  it("an unedited session refreshes onto the live plot and the notice names the new revision", () => {
    const before = doc("Old");
    const now = doc("Newer");
    live.doc = now;
    useApp.setState({ figurePublicationSession: { target: "window", windowId: "w1", baseline: before, draft: before } });
    rebaseFigurePublicationOnLive();
    const refreshed = useApp.getState().figurePublicationSession!.draft;
    expect(refreshed.plot.view.plotTitle).toBe("Newer");
    expect(useApp.getState().status).toMatch(/preview refreshed.*plot changed/i);
    expect(useApp.getState().status).toContain(`revision ${figureRevision(refreshed)}`);
    expect(useApp.getState().status).not.toContain(figureRevision(before));
  });

  it("a session with its own edits is left alone and is silent", () => {
    const base = doc("Old");
    const edited = doc("Typed");
    live.doc = doc("Newer");
    useApp.setState({ figurePublicationSession: { target: "window", windowId: "w1", baseline: base, draft: edited }, status: "" });
    rebaseFigurePublicationOnLive();
    expect(useApp.getState().figurePublicationSession!.draft).toBe(edited);
    expect(useApp.getState().status).toBe("");
  });
});
