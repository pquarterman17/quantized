import { beforeEach, describe, expect, it } from "vitest";

import { planOriginFolders } from "./originFolders";
import type { Dataset } from "./types";

let seq = 0;
const gen = () => `f${++seq}`;
beforeEach(() => {
  seq = 0;
});

const ds = (id: string, book?: string, path?: string[]): Dataset => ({
  id,
  name: id,
  data: {
    time: [],
    values: [],
    labels: [],
    units: [],
    metadata: {
      ...(book !== undefined ? { origin_book: book } : {}),
      ...(path !== undefined ? { origin_folder_path: path } : {}),
    },
  },
});

// folderId → name, for readable assertions
const nameOf = (plan: { folders: { id: string; name: string }[] }) =>
  new Map(plan.folders.map((f) => [f.id, f.name]));

describe("planOriginFolders", () => {
  it("fallback: single-sheet books with no folder path sit directly in the project folder", () => {
    const plan = planOriginFolders("Moke", [ds("d1", "Book1"), ds("d2", "Book2")], gen);
    expect(plan.folders.map((f) => f.name)).toEqual(["Moke"]); // just the project folder
    const project = plan.folders[0].id;
    expect(plan.membership).toEqual({ d1: project, d2: project });
    expect(plan.expanded).toEqual([project]);
  });

  it("gives a multi-sheet workbook its own subfolder holding the sheets", () => {
    const plan = planOriginFolders(
      "X",
      [ds("s1", "Book4"), ds("s2", "Book4@2"), ds("s3", "Book4@3")],
      gen,
    );
    const names = nameOf(plan);
    // project "X" → "Book4" folder → the 3 sheets
    expect(plan.folders.map((f) => f.name)).toEqual(["X", "Book4"]);
    const book4 = plan.folders[1].id;
    expect(names.get(plan.folders[1].parentId!)).toBe("X");
    expect(plan.membership).toEqual({ s1: book4, s2: book4, s3: book4 });
  });

  it("materializes the Origin Project Explorer folder paths (Moke case)", () => {
    const plan = planOriginFolders(
      "Moke",
      [
        ds("d1", "Book1", ["Raw normalized"]),
        ds("d2", "Book2", ["Raw normalized"]),
        ds("d3", "Book4", ["Sub subtraction"]),
        ds("d4", "Book4@2", ["Sub subtraction"]),
        ds("d5", "Book5", ["Sub subtraction"]),
      ],
      gen,
    );
    const names = nameOf(plan);
    // Moke → {Raw normalized, Sub subtraction}; Sub subtraction → Book4 (2 sheets)
    expect(plan.folders.map((f) => f.name)).toEqual([
      "Moke",
      "Raw normalized",
      "Sub subtraction",
      "Book4",
    ]);
    const raw = plan.folders[1].id;
    const sub = plan.folders[2].id;
    const book4 = plan.folders[3].id;
    expect(names.get(plan.folders[1].parentId!)).toBe("Moke"); // Raw normalized under project
    expect(names.get(plan.folders[3].parentId!)).toBe("Sub subtraction"); // Book4 nested
    expect(plan.membership.d1).toBe(raw);
    expect(plan.membership.d2).toBe(raw);
    expect(plan.membership.d3).toBe(book4); // sheet of Book4
    expect(plan.membership.d4).toBe(book4);
    expect(plan.membership.d5).toBe(sub); // single-sheet Book5 straight into its folder
  });

  it("creates nested intermediate folders for a deep path and reuses them", () => {
    const plan = planOriginFolders(
      "P",
      [ds("d1", "B1", ["A", "B"]), ds("d2", "B2", ["A", "B"]), ds("d3", "B3", ["A"])],
      gen,
    );
    const names = nameOf(plan);
    // P → A → B ; A and B each created once, shared
    expect(plan.folders.map((f) => f.name)).toEqual(["P", "A", "B"]);
    const a = plan.folders[1].id;
    const b = plan.folders[2].id;
    expect(names.get(plan.folders[2].parentId!)).toBe("A"); // B under A
    expect(plan.membership.d1).toBe(b);
    expect(plan.membership.d2).toBe(b); // reused, not duplicated
    expect(plan.membership.d3).toBe(a); // one level up
  });

  it("all created folders are expanded and the project folder leads", () => {
    const plan = planOriginFolders("P", [ds("d1", "B", ["A"])], gen);
    expect(plan.expanded).toEqual(plan.folders.map((f) => f.id));
    expect(plan.folders[0].name).toBe("P");
    expect(plan.folders[0].parentId).toBeNull();
  });
});

// These exercise structures the corpus samples don't contain — the real proof
// the planner is general, not tuned to Moke/RockingCurve's shapes.
describe("planOriginFolders generality (not tuned to samples)", () => {
  const byId = (plan: ReturnType<typeof planOriginFolders>) =>
    new Map(plan.folders.map((f) => [f.id, f]));

  it("a folder named like a nested path does NOT collide with that path", () => {
    const plan = planOriginFolders(
      "P",
      [
        ds("d1", "B1", ["Raw normalized"]), // ONE folder literally named "Raw normalized"
        ds("d2", "B2", ["Raw", "normalized"]), // vs the two-level path Raw → normalized
      ],
      gen,
    );
    const m = byId(plan);
    const d1f = m.get(plan.membership.d1)!;
    const d2f = m.get(plan.membership.d2)!;
    expect(d1f.name).toBe("Raw normalized");
    expect(m.get(d1f.parentId!)!.name).toBe("P"); // one folder, directly under project
    expect(d2f.name).toBe("normalized");
    expect(m.get(d2f.parentId!)!.name).toBe("Raw"); // genuinely nested, distinct
    expect(plan.membership.d1).not.toBe(plan.membership.d2);
  });

  it("keeps duplicate folder names under different parents distinct", () => {
    const plan = planOriginFolders(
      "P",
      [ds("d1", "B1", ["A", "Data"]), ds("d2", "B2", ["B", "Data"])],
      gen,
    );
    const data = plan.folders.filter((f) => f.name === "Data");
    expect(data).toHaveLength(2); // two separate "Data" folders
    const m = byId(plan);
    expect(data.map((f) => m.get(f.parentId!)!.name).sort()).toEqual(["A", "B"]);
    expect(plan.membership.d1).not.toBe(plan.membership.d2);
  });

  it("handles arbitrary nesting depth and root-level books together", () => {
    const plan = planOriginFolders(
      "P",
      [ds("root", "R"), ds("deep", "D", ["a", "b", "c", "d"])],
      gen,
    );
    const byName = new Map(plan.folders.map((f) => [f.name, f]));
    expect(["a", "b", "c", "d"].every((n) => byName.has(n))).toBe(true);
    expect(byName.get("b")!.parentId).toBe(byName.get("a")!.id); // chain a→b→c→d
    expect(byName.get("d")!.parentId).toBe(byName.get("c")!.id);
    expect(plan.membership.root).toBe(plan.folders[0].id); // book with no path → project root
    expect(plan.membership.deep).toBe(byName.get("d")!.id);
  });

  it("preserves unicode / punctuation folder names verbatim", () => {
    const plan = planOriginFolders("P", [ds("d1", "B", ["Messungen · 2024 (µ₀H)"])], gen);
    expect(plan.folders.map((f) => f.name)).toContain("Messungen · 2024 (µ₀H)");
  });
});
