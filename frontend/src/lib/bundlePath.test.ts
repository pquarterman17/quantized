// P1.7 PR 3 (Pack Project, frontend half): `isBundleRelativePath`/
// `resolveBundlePath` are a faithful port of
// `quantized.portable.layout.is_bundle_relative`/`join_bundle_path` — this
// suite mirrors that Python module's own test cases (accept/reject) rule for
// rule, so the two sides can never quietly drift apart.

import { describe, expect, it } from "vitest";

import { isBundleRelativePath, resolveBundlePath } from "./bundlePath";

describe("isBundleRelativePath", () => {
  it("accepts a plain sources/-rooted path", () => {
    expect(isBundleRelativePath("sources/a.csv")).toBe(true);
  });

  it("accepts a nested sources/-rooted path", () => {
    expect(isBundleRelativePath("sources/sub/a.csv")).toBe(true);
  });

  it("accepts a Unicode filename", () => {
    expect(isBundleRelativePath("sources/日本語-サンプル.csv")).toBe(true);
  });

  it("rejects a parent-traversal segment", () => {
    expect(isBundleRelativePath("../x")).toBe(false);
  });

  it("rejects a parent-traversal segment inside sources/", () => {
    expect(isBundleRelativePath("sources/../x")).toBe(false);
  });

  it("rejects a current-directory segment", () => {
    expect(isBundleRelativePath("sources/./x")).toBe(false);
  });

  it("rejects an absolute POSIX path", () => {
    expect(isBundleRelativePath("/abs")).toBe(false);
  });

  it("rejects a drive-letter path", () => {
    expect(isBundleRelativePath("C:/x")).toBe(false);
  });

  it("rejects a UNC path", () => {
    expect(isBundleRelativePath("\\\\srv\\share")).toBe(false);
  });

  it("rejects a backslash-separated path (never reinterpreted as a separator)", () => {
    expect(isBundleRelativePath("sources\\a.csv")).toBe(false);
  });

  it("rejects a doubled separator (an empty segment)", () => {
    expect(isBundleRelativePath("sources//a")).toBe(false);
  });

  it("rejects a path not rooted at sources/", () => {
    expect(isBundleRelativePath("other/a.csv")).toBe(false);
  });

  it("rejects a segment with a colon (would be reinterpreted as a drive letter)", () => {
    expect(isBundleRelativePath("sources/D:evil")).toBe(false);
  });

  it("rejects a segment with an illegal character", () => {
    expect(isBundleRelativePath("sources/a<b")).toBe(false);
  });

  it("rejects a Windows-reserved device name", () => {
    expect(isBundleRelativePath("sources/CON.csv")).toBe(false);
  });

  it("rejects a reserved device name regardless of a compound extension", () => {
    expect(isBundleRelativePath("sources/NUL.tar.gz")).toBe(false);
  });

  it("rejects a trailing dot", () => {
    expect(isBundleRelativePath("sources/x.")).toBe(false);
  });

  it("rejects a trailing space", () => {
    expect(isBundleRelativePath("sources/x ")).toBe(false);
  });

  it("rejects a NUL byte anywhere in the path", () => {
    expect(isBundleRelativePath("sources/a\u0000b")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isBundleRelativePath("")).toBe(false);
  });
});

describe("resolveBundlePath", () => {
  it("joins a POSIX project directory with forward slashes", () => {
    expect(resolveBundlePath("/proj", "sources/a.csv")).toBe("/proj/sources/a.csv");
  });

  it("joins a Windows project directory with backslashes", () => {
    expect(resolveBundlePath("C:\\proj", "sources/a.csv")).toBe("C:\\proj\\sources\\a.csv");
  });

  it("returns null for a rejected relative path", () => {
    expect(resolveBundlePath("/proj", "../escape")).toBeNull();
  });

  it("returns null for a traversal segment inside sources/", () => {
    expect(resolveBundlePath("/proj", "sources/../escape")).toBeNull();
  });
});
