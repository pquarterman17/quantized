// UX-H review items 3 and 4: what counts as unpublished work in the export
// view, and how a session follows the plot when nothing would be lost.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFigureDocument, type FigureDocument } from "../../../lib/figureDocument";
import { defaultPlotView } from "../../../lib/plotview";
import type { FigurePublicationSession } from "../../../store/figureLifecycle";
import { figurePublicationDirty, figurePublicationEdited } from "../../../store/figureUnsavedEdits";
import { useApp } from "../../../store/useApp";
import { selectSessionExportStale } from "./canonicalSession";
import { useLiveRebase } from "./useLiveRebase";

const live = vi.hoisted(() => ({ doc: null as unknown }));
vi.mock("../../../store/liveWindowDocument", () => ({ liveWindowDocument: () => live.doc }));

const doc = (title = ""): FigureDocument =>
  createFigureDocument({ id: "f1", name: "Fig", datasetId: "d1", view: { ...defaultPlotView(), plotTitle: title } });

const session = (draft: FigureDocument, over: Partial<FigurePublicationSession> = {}): FigurePublicationSession => ({
  target: "window", windowId: "w1", baseline: doc(), draft, ...over,
});

const withOutput = (d: FigureDocument, output: Partial<FigureDocument["output"]>): FigureDocument => ({ ...d, output: { ...d.output, ...output } });

describe("export-view dirtiness (UX-H item 4)", () => {
  it("does not count format / preset / DPI choices as unpublished edits", () => {
    const s = session(withOutput(doc(), { format: "svg", stylePreset: "aps", dpi: 600 }));
    expect(figurePublicationEdited(s)).toBe(false);
    expect(figurePublicationDirty(s)).toBe(false);
  });

  it("counts a real figure edit", () => {
    expect(figurePublicationDirty(session(doc("New title")))).toBe(true);
  });

  it("asks nothing on close right after that edit was exported, and again once edited further", () => {
    const exported = doc("New title");
    expect(figurePublicationDirty(session(withOutput(exported, { format: "png" }), { exported }))).toBe(false);
    expect(figurePublicationDirty(session(doc("Newer title"), { exported }))).toBe(true);
  });
});

describe("selectSessionExportStale (UX-H item 3)", () => {
  beforeEach(() => {
    live.doc = doc("Changed on Stage");
    useApp.setState({ plotWindows: [{ id: "w1" }, { id: "w2" }] as never, focusedWindowId: "w1" });
  });

  it("is stale when the target window moved on, focused or not", () => {
    useApp.setState({ figurePublicationSession: session(doc("Typed")) });
    expect(selectSessionExportStale(useApp.getState())).toBe(true);
    useApp.setState({ focusedWindowId: "w2" });
    expect(selectSessionExportStale(useApp.getState())).toBe(true);
  });

  it("never blocks a Library or detached draft: it IS the document it exports", () => {
    useApp.setState({ figurePublicationSession: session(doc(), { target: "library", windowId: null }) });
    expect(selectSessionExportStale(useApp.getState())).toBe(false);
    useApp.setState({ figurePublicationSession: session(doc(), { target: "new-editable", windowId: null }) });
    expect(selectSessionExportStale(useApp.getState())).toBe(false);
    useApp.setState({ figurePublicationSession: null });
  });
});

describe("useLiveRebase (UX-H item 3)", () => {
  beforeEach(() => {
    live.doc = doc("Changed on Stage");
    useApp.setState({ plotWindows: [{ id: "w1" }] as never, figurePublicationSession: null });
  });

  it("re-bases an unedited session onto the live plot, keeping its output choices", () => {
    useApp.setState({ figurePublicationSession: session(withOutput(doc(), { format: "svg", stylePreset: "aps", dpi: 450 })) });
    renderHook(() => useLiveRebase());
    const next = useApp.getState().figurePublicationSession!;
    expect(next.baseline.plot).toEqual((live.doc as FigureDocument).plot);
    expect(next.draft.plot).toEqual((live.doc as FigureDocument).plot);
    expect(next.draft.output).toMatchObject({ format: "svg", stylePreset: "aps", dpi: 450 });
  });

  it("leaves a session with preview edits alone (Export is disabled instead)", () => {
    const edited = session(doc("Typed in the preview"));
    useApp.setState({ figurePublicationSession: edited });
    renderHook(() => useLiveRebase());
    expect(useApp.getState().figurePublicationSession).toBe(edited);
  });

  it("re-bases once the preview's own edits are undone, with no further plot change", () => {
    useApp.setState({ figurePublicationSession: session(doc("Typed in the preview")) });
    renderHook(() => useLiveRebase());
    expect(useApp.getState().figurePublicationSession?.baseline.plot).not.toEqual((live.doc as FigureDocument).plot);
    act(() => useApp.setState({ figurePublicationSession: session(doc()) })); // the edit, undone
    expect(useApp.getState().figurePublicationSession?.baseline.plot).toEqual((live.doc as FigureDocument).plot);
  });

  it("never re-bases a detached draft", () => {
    const detached = session(doc(), { target: "new-editable", windowId: null });
    useApp.setState({ figurePublicationSession: detached });
    renderHook(() => useLiveRebase());
    expect(useApp.getState().figurePublicationSession).toBe(detached);
  });
});
