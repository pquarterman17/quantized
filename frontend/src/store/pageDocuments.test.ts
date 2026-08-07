// Store-level lifecycle tests for saved multi-panel pages
// (FIGURE_AUTHORING_WORKFLOW_PLAN F3.3) — save/save-as/rename/duplicate/
// delete/reopen, undo/redo (pages already ride the shared history snapshot —
// F3.1), and the .dwk round trip. Mirrors store/figureLifecycle.test.ts's
// pattern: exercise the composed `useApp` store directly rather than the
// slice factory in isolation, since every action reaches into sibling slices
// (recordHistory, figurePageOpen) through `get()`.

import { beforeEach, describe, expect, it } from "vitest";

import { createPageDocument, type PageDocument } from "../lib/pageDocument";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import { useApp } from "./useApp";

const page = (overrides: Partial<PageDocument> = {}): PageDocument =>
  createPageDocument({
    id: "page-1",
    name: "Results page",
    rows: 1,
    cols: 2,
    panels: [
      { figureId: "figure-1", label: null, title: null },
      { figureId: null, label: null, title: null },
    ],
    ...overrides,
  });

beforeEach(() => {
  useApp.setState({
    pages: [],
    pageDocSeed: null,
    figurePageOpen: false,
    history: [],
    future: [],
  });
});

describe("savePage", () => {
  it("inserts a fresh session's draft on the first save", () => {
    const draft = page();
    const id = useApp.getState().savePage(draft);
    expect(id).toBe("page-1");
    expect(useApp.getState().pages).toHaveLength(1);
    expect(useApp.getState().pages[0]).toMatchObject({ id: "page-1", name: "Results page" });
  });

  it("updates in place on a later save (same id), bumping modifiedAt", async () => {
    const draft = page();
    useApp.getState().savePage(draft);
    const firstModified = useApp.getState().pages[0].modifiedAt;

    await new Promise((resolve) => setTimeout(resolve, 2));
    const edited: PageDocument = { ...draft, name: "Results page (renamed)" };
    useApp.getState().savePage(edited);

    expect(useApp.getState().pages).toHaveLength(1); // still one entry, not two
    expect(useApp.getState().pages[0].name).toBe("Results page (renamed)");
    expect(useApp.getState().pages[0].modifiedAt >= firstModified).toBe(true);
  });

  it("records one undo entry per save", () => {
    const before = useApp.getState().history.length;
    useApp.getState().savePage(page());
    expect(useApp.getState().history).toHaveLength(before + 1);
    useApp.getState().undo();
    expect(useApp.getState().pages).toEqual([]);
  });
});

describe("savePageAs", () => {
  it("always creates a NEW id, leaving the original untouched", () => {
    useApp.getState().savePage(page());
    const copyId = useApp.getState().savePageAs(page({ name: "Results page" }), "Results page copy");
    expect(copyId).not.toBe("page-1");
    expect(useApp.getState().pages).toHaveLength(2);
    expect(useApp.getState().pages.map((p) => p.name)).toEqual([
      "Results page",
      "Results page copy",
    ]);
  });

  it("rejects a blank name without creating anything", () => {
    const before = useApp.getState().pages.length;
    expect(useApp.getState().savePageAs(page(), "   ")).toBeNull();
    expect(useApp.getState().pages).toHaveLength(before);
  });
});

describe("rename / duplicate / delete", () => {
  beforeEach(() => {
    useApp.getState().savePage(page());
  });

  it("renames a saved page and bumps modifiedAt", () => {
    const before = useApp.getState().pages[0].modifiedAt;
    useApp.getState().renamePageDocument("page-1", "New name");
    expect(useApp.getState().pages[0].name).toBe("New name");
    expect(useApp.getState().pages[0].modifiedAt >= before).toBe(true);
  });

  it("ignores a blank rename", () => {
    useApp.getState().renamePageDocument("page-1", "   ");
    expect(useApp.getState().pages[0].name).toBe("Results page");
  });

  it("duplicates a saved page with a fresh id and '<name> copy'", () => {
    const copyId = useApp.getState().duplicatePageDocument("page-1");
    expect(copyId).not.toBe("page-1");
    expect(useApp.getState().pages).toHaveLength(2);
    const copy = useApp.getState().pages.find((p) => p.id === copyId)!;
    expect(copy.name).toBe("Results page copy");
    expect(copy.panels).toEqual(useApp.getState().pages[0].panels);
  });

  it("deletes a saved page and undo restores it", () => {
    useApp.getState().deletePageDocument("page-1");
    expect(useApp.getState().pages).toEqual([]);
    useApp.getState().undo();
    expect(useApp.getState().pages).toHaveLength(1);
    expect(useApp.getState().pages[0].id).toBe("page-1");
  });

  it("is a no-op deleting an id that does not exist (no history entry)", () => {
    const before = useApp.getState().history.length;
    useApp.getState().deletePageDocument("nonexistent");
    expect(useApp.getState().pages).toHaveLength(1);
    expect(useApp.getState().history).toHaveLength(before);
  });
});

describe("openPageDocument (reopen)", () => {
  it("seeds pageDocSeed and opens the Figure Page workshop", () => {
    useApp.getState().savePage(page());
    const ok = useApp.getState().openPageDocument("page-1");
    expect(ok).toBe(true);
    expect(useApp.getState().figurePageOpen).toBe(true);
    expect(useApp.getState().pageDocSeed).toMatchObject({ id: "page-1", name: "Results page" });
  });

  it("returns false for an id that does not exist, without opening anything", () => {
    const ok = useApp.getState().openPageDocument("nonexistent");
    expect(ok).toBe(false);
    expect(useApp.getState().figurePageOpen).toBe(false);
    expect(useApp.getState().pageDocSeed).toBeNull();
  });

  it("clearPageDocSeed clears the one-shot seed", () => {
    useApp.getState().savePage(page());
    useApp.getState().openPageDocument("page-1");
    useApp.getState().clearPageDocSeed();
    expect(useApp.getState().pageDocSeed).toBeNull();
  });
});

describe(".dwk workspace round trip", () => {
  it("saved pages survive serialize/parse", () => {
    useApp.getState().savePage(page());
    useApp.getState().savePage(page({ id: "page-2", name: "Second page" }));
    const s = useApp.getState();
    const raw = serializeWorkspace({ datasets: s.datasets, pages: s.pages });
    const restored = parseWorkspace(raw);
    expect(restored.pages.map((p) => p.id)).toEqual(["page-1", "page-2"]);
    expect(restored.pages[0]).toEqual(s.pages[0]);
  });
});
