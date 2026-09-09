// P1.2 box 2 ("Add workspace version/migration tests") + box 3's format half
// ("old-version round trips pass" / torn-write half — see
// `openWorkspaceCommand.test.ts` and `autosave.test.ts` for the two
// consumer-facing torn-write checks this file's own truncation tests feed).
//
// Exercises the FOUR frozen fixtures in `./__fixtures__/workspace/` (see that
// directory's README for their provenance and the one documented, deliberate
// non-idempotent field) rather than an inline object per test — a real,
// frozen document is what a genuinely OLD save looks like; an inline object
// built fresh in the test file would just re-describe today's parser back at
// itself.
import { describe, expect, it } from "vitest";

import v1 from "./__fixtures__/workspace/v1.dwk.json";
import v2 from "./__fixtures__/workspace/v2.dwk.json";
import v3 from "./__fixtures__/workspace/v3.dwk.json";
import v4 from "./__fixtures__/workspace/v4.dwk.json";
import { parseWorkspace, serializeWorkspace, WORKSPACE_FORMAT } from "./workspace";
import { parseWorkspaceBlob } from "./workspaceParseCore";

const FIXTURES = [
  { version: 1, doc: v1 },
  { version: 2, doc: v2 },
  { version: 3, doc: v3 },
  { version: 4, doc: v4 },
] as const;

const VIEWPORT = { width: 1600, height: 900 };

/** Strip the two fields that are non-deterministic BY DESIGN, not by bug —
 *  see the fixtures' own README "A known, deliberate non-determinism"
 *  section. Everything else in a re-serialized document must match exactly. */
function normalizeForIdempotency(text: string): unknown {
  const doc = JSON.parse(text) as Record<string, unknown>;
  delete doc.savedAt;
  if (Array.isArray(doc.pipeline)) {
    doc.pipeline = doc.pipeline.map((step) => {
      if (typeof step !== "object" || step === null) return step;
      const { id: _id, ...rest } = step as Record<string, unknown>;
      return rest;
    });
  }
  return doc;
}

describe("workspace migration — frozen v1-v4 fixtures (P1.2 box 2)", () => {
  for (const { version, doc } of FIXTURES) {
    const text = JSON.stringify(doc);

    it(`v${version}: parses without throwing and carries no migration warnings`, () => {
      const loaded = parseWorkspace(text, VIEWPORT);
      expect(loaded.migrationWarnings).toEqual([]);
    });

    it(`v${version}: re-serializes as a version: 4 document`, () => {
      const loaded = parseWorkspace(text, VIEWPORT);
      const reserialized = JSON.parse(serializeWorkspace(loaded)) as { version: number; format: string };
      expect(reserialized.version).toBe(4);
      expect(reserialized.format).toBe(WORKSPACE_FORMAT);
    });

    it(`v${version}: round trip is idempotent (normalized for the two by-design volatile fields)`, () => {
      const firstText = serializeWorkspace(parseWorkspace(text, VIEWPORT));
      const secondText = serializeWorkspace(parseWorkspace(firstText, VIEWPORT));
      expect(normalizeForIdempotency(secondText)).toEqual(normalizeForIdempotency(firstText));
    });

    it(`v${version}: dataset ids/labels/row counts survive`, () => {
      const loaded = parseWorkspace(text, VIEWPORT);
      expect(loaded.datasets.map((d) => d.id)).toEqual(["a", "b"]);
      expect(loaded.datasets[0].name).toBe("run-a.csv");
      expect(loaded.datasets[0].data.time).toHaveLength(4);
      expect(loaded.datasets[1].name).toBe("run-b.xy");
      expect(loaded.datasets[1].data.time).toHaveLength(3);
    });

    it(`v${version}: parseWorkspaceBlob reports ok: true`, async () => {
      const result = await parseWorkspaceBlob(new Blob([text], { type: "application/json" }), VIEWPORT);
      expect(result.ok).toBe(true);
    });

    if (version >= 2) {
      it(`v${version}: the folder tree survives (v2+)`, () => {
        const loaded = parseWorkspace(text, VIEWPORT);
        expect(loaded.folders.map((f) => f.id)).toEqual(["f1"]);
        expect(loaded.datasets.find((d) => d.id === "a")!.folderId).toBe("f1");
        expect(loaded.activeId).toBe("a");
        expect(loaded.selectedIds).toEqual(["a", "b"]);
      });
    } else {
      it(`v${version}: no folder tree yet (defaults empty)`, () => {
        const loaded = parseWorkspace(text, VIEWPORT);
        expect(loaded.folders).toEqual([]);
      });
    }

    if (version >= 3) {
      it(`v${version}: pipeline steps + recalc mode survive (v3+)`, () => {
        const loaded = parseWorkspace(text, VIEWPORT);
        expect(loaded.recalcMode).toBe("manual");
        expect(loaded.macroSteps).toHaveLength(1);
        expect(loaded.macroSteps[0].label).toBe("Add column ratio");
        expect(loaded.macroSteps[0].params).toEqual({ name: "ratio", expr: "A / B" });
      });
    } else {
      it(`v${version}: no pipeline yet (defaults empty, auto recalc)`, () => {
        const loaded = parseWorkspace(text, VIEWPORT);
        expect(loaded.macroSteps).toEqual([]);
        expect(loaded.recalcMode).toBe("auto");
      });
    }

    if (version === 4) {
      it("v4: workbooks + membership survive verbatim", () => {
        const loaded = parseWorkspace(text, VIEWPORT);
        expect(loaded.workbooks.map((w) => w.id)).toEqual(["wb-1", "wb-2"]);
        expect(loaded.datasets.find((d) => d.id === "a")!.workbookId).toBe("wb-1");
        expect(loaded.datasets.find((d) => d.id === "b")!.workbookId).toBe("wb-2");
      });
    } else {
      it(`v${version}: deriveWorkbooks produces exactly one workbook per dataset-group`, () => {
        // Header promise, lib/workbooks.ts: "one imported SOURCE FILE becomes
        // one workbook". Neither fixture dataset carries a `source.path` or
        // Origin-book metadata, so each is its own singleton group -- two
        // datasets, two derived workbooks, one each.
        const loaded = parseWorkspace(text, VIEWPORT);
        expect(loaded.workbooks).toHaveLength(2);
        const ids = new Set(loaded.datasets.map((d) => d.workbookId));
        expect(ids.size).toBe(2); // no two datasets share a derived workbook
        for (const d of loaded.datasets) expect(d.workbookId).toBeTruthy();
      });
    }
  }

  it("a copy with version: 5 throws /unsupported workspace version/", () => {
    const future = { ...(v4 as Record<string, unknown>), version: 5 };
    expect(() => parseWorkspace(JSON.stringify(future))).toThrow(/unsupported workspace version/);
  });
});

// LIBRARY_WORKBOOK_UX_PLAN "Acceptance scenarios": "Save/reopen a migrated
// legacy workspace: workbook membership and source provenance remain
// intact." The v1-v4 fixtures above cover generic dataset-id/label survival
// and workbook-count derivation, but none carries real Origin-book
// provenance (see the "deriveWorkbooks produces exactly one workbook per
// dataset-group" case's own comment) — this exercises the SPECIFIC case the
// scenario names: a pre-workbook (v1) document whose two datasets are two
// sheets of the SAME Origin book, migrated on load into one multi-sheet
// workbook (lib/workbooks.ts's L0.3), then actually SAVED and REOPENED
// (not just loaded once) to prove the derived membership and provenance
// don't drift or get re-derived differently the second time around.
describe("workspace migration — save/reopen a migrated legacy Origin workbook (LIBRARY_WORKBOOK_UX_PLAN acceptance scenario)", () => {
  const legacyOriginDoc = {
    format: WORKSPACE_FORMAT,
    version: 1,
    datasets: [
      {
        id: "s1",
        name: "project.opj:Book4/Data1",
        data: {
          time: [0, 1],
          values: [[1], [2]],
          labels: ["Y"],
          units: [""],
          metadata: { origin_book: "Book4" }, // sheet 1 (the base book)
        },
      },
      {
        id: "s2",
        name: "project.opj:Book4/Data2",
        data: {
          time: [0, 1],
          values: [[3], [4]],
          labels: ["Y"],
          units: [""],
          metadata: { origin_book: "Book4@2" }, // sheet 2, same book
        },
      },
    ],
  };
  const text = JSON.stringify(legacyOriginDoc);

  it("migrates the v1 multi-sheet Origin book into one workbook with membership + provenance", () => {
    const loaded = parseWorkspace(text, VIEWPORT);
    expect(loaded.workbooks).toHaveLength(1);
    expect(loaded.workbooks[0].originBook).toBe("Book4");
    expect(loaded.datasets.map((d) => d.workbookId)).toEqual([loaded.workbooks[0].id, loaded.workbooks[0].id]);
  });

  it("save (re-serialize) then reopen (re-parse) preserves that workbook's membership and provenance exactly", () => {
    const firstLoad = parseWorkspace(text, VIEWPORT);
    const wbId = firstLoad.workbooks[0].id;
    const saved = serializeWorkspace(firstLoad);
    const reopened = parseWorkspace(saved, VIEWPORT);

    expect(reopened.workbooks).toHaveLength(1); // not re-split or re-merged
    expect(reopened.workbooks[0].id).toBe(wbId); // same identity, not re-derived under a fresh id
    expect(reopened.workbooks[0].originBook).toBe("Book4"); // provenance intact
    expect(reopened.datasets.find((d) => d.id === "s1")!.workbookId).toBe(wbId);
    expect(reopened.datasets.find((d) => d.id === "s2")!.workbookId).toBe(wbId);
    // Sheet order preserved (L0.16): sheet 1 before sheet 2.
    expect(reopened.datasets.map((d) => d.id)).toEqual(["s1", "s2"]);
  });
});

describe("workspace migration — torn writes (P1.2 box 3)", () => {
  for (const { version, doc } of FIXTURES) {
    const text = JSON.stringify(doc);
    const cutPoints = [0.25, 0.5, 0.9].map((frac) => Math.floor(text.length * frac));
    cutPoints.push(text.length - 1);

    for (const cut of cutPoints) {
      it(`v${version}: truncated at ${cut}/${text.length} bytes throws, never returns a partial workspace`, () => {
        const truncated = text.slice(0, cut);
        expect(() => parseWorkspace(truncated, VIEWPORT)).toThrow(/bad JSON|not a workspace/);
      });

      it(`v${version}: parseWorkspaceBlob on the same truncation reports ok: false with that message`, async () => {
        const truncated = text.slice(0, cut);
        const result = await parseWorkspaceBlob(new Blob([truncated]), VIEWPORT);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toMatch(/bad JSON|not a workspace/);
      });
    }
  }
});
