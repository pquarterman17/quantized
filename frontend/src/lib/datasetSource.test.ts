// `parseDatasetSource` — the persisted `Dataset.source` validator. The
// pre-existing `kind: "path"` behavior (MAIN_PLAN #10 / P1.7 P1-B) is
// unchanged; this suite adds the P1.7 PR 3 `kind: "bundle"` extension
// (resolves only with a `projectDir`, degrades to `null` otherwise — same
// "never guess" discipline as every other malformed-field case here).

import { describe, expect, it } from "vitest";

import { parseDatasetSource } from "./datasetSource";

describe("parseDatasetSource — kind: path (unchanged)", () => {
  it("accepts a well-formed path source", () => {
    expect(parseDatasetSource({ kind: "path", path: "/data/sample.dat" })).toEqual({
      kind: "path",
      path: "/data/sample.dat",
    });
  });

  it("carries checksum/mtime/size when present and valid", () => {
    const v = { kind: "path", path: "/data/x.dat", checksum: "sha256:abc", mtime: 1700000000, size: 42 };
    expect(parseDatasetSource(v)).toEqual(v);
  });

  it("rejects the wrong kind", () => {
    expect(parseDatasetSource({ kind: "upload" })).toBeNull();
  });

  it("rejects a missing path", () => {
    expect(parseDatasetSource({ kind: "path" })).toBeNull();
  });

  it("rejects an empty path", () => {
    expect(parseDatasetSource({ kind: "path", path: "" })).toBeNull();
  });

  it("omits an invalid checksum/mtime/size rather than restoring garbage", () => {
    const v = { kind: "path", path: "/data/x.dat", checksum: 123, mtime: "later", size: "big" };
    expect(parseDatasetSource(v)).toEqual({ kind: "path", path: "/data/x.dat" });
  });

  it("is unaffected by a projectDir being passed alongside a path source", () => {
    const v = { kind: "path", path: "/data/x.dat" };
    expect(parseDatasetSource(v, "/proj")).toEqual(v);
  });

  it("carries packedFrom (provenance) alongside an ordinary path source", () => {
    const v = { kind: "path", path: "/proj/sources/a.csv", packedFrom: "/original/data/a.csv" };
    expect(parseDatasetSource(v)).toEqual(v);
  });

  it("drops a non-string/empty packedFrom rather than restoring garbage", () => {
    expect(parseDatasetSource({ kind: "path", path: "/x.dat", packedFrom: 7 })).toEqual({
      kind: "path",
      path: "/x.dat",
    });
    expect(parseDatasetSource({ kind: "path", path: "/x.dat", packedFrom: "" })).toEqual({
      kind: "path",
      path: "/x.dat",
    });
  });
});

describe("parseDatasetSource — kind: bundle (P1.7 PR 3)", () => {
  it("resolves to an absolute path and records bundlePath, given a POSIX projectDir", () => {
    expect(parseDatasetSource({ kind: "bundle", path: "sources/run1.csv" }, "/proj")).toEqual({
      kind: "path",
      path: "/proj/sources/run1.csv",
      bundlePath: "sources/run1.csv",
    });
  });

  it("resolves to a backslash-joined absolute path given a Windows projectDir", () => {
    expect(parseDatasetSource({ kind: "bundle", path: "sources/run1.csv" }, "C:\\proj")).toEqual({
      kind: "path",
      path: "C:\\proj\\sources\\run1.csv",
      bundlePath: "sources/run1.csv",
    });
  });

  it("carries checksum/mtime/size and packedFrom through the resolve", () => {
    const v = {
      kind: "bundle",
      path: "sources/run1.csv",
      checksum: "sha256:abc",
      mtime: 1700000000,
      size: 42,
      packedFrom: "/original/data/run1.csv",
    };
    expect(parseDatasetSource(v, "/proj")).toEqual({
      kind: "path",
      path: "/proj/sources/run1.csv",
      bundlePath: "sources/run1.csv",
      checksum: "sha256:abc",
      mtime: 1700000000,
      size: 42,
      packedFrom: "/original/data/run1.csv",
    });
  });

  it("returns null with no projectDir — the documented degrade", () => {
    expect(parseDatasetSource({ kind: "bundle", path: "sources/run1.csv" })).toBeNull();
  });

  it("returns null for a traversal path, even with a projectDir", () => {
    expect(parseDatasetSource({ kind: "bundle", path: "sources/../escape.csv" }, "/proj")).toBeNull();
  });

  it("returns null for a path not rooted at sources/", () => {
    expect(parseDatasetSource({ kind: "bundle", path: "other/run1.csv" }, "/proj")).toBeNull();
  });

  it("returns null for a non-string path", () => {
    expect(parseDatasetSource({ kind: "bundle", path: 7 }, "/proj")).toBeNull();
  });
});
