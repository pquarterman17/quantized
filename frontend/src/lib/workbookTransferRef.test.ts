// Group F — the large-workbook descriptor and the transfer-store client.
// `fetch` is stubbed per test; the backend half of the contract (atomic
// write, expiry, eviction, token check, two backends sharing one directory)
// is pinned by tests/test_workbook_transfer_store.py and
// tests/test_api_workbook_transfer.py.

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ParseTransferResult, WorkbookTransferPackage } from "./workbookTransfer";
import {
  fetchReferencedPackage,
  MAX_STORED_TRANSFER_BYTES,
  readTransferRef,
  storeAsReference,
  WORKBOOK_TRANSFER_REF_FORMAT,
  type WorkbookTransferRef,
} from "./workbookTransferRef";

const ID = "0123456789abcdef0123456789abcdef";
const TOK = "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTtok"; // the server's shape: 43 url-safe characters
const FUTURE = "2999-01-01T00:00:00Z";
const PAST = "2000-01-01T00:00:00Z";

const ref = (extra: Partial<WorkbookTransferRef> = {}): WorkbookTransferRef => ({
  format: WORKBOOK_TRANSFER_REF_FORMAT,
  version: 1,
  summary: "s",
  id: ID,
  token: TOK,
  size: 3,
  expiresAt: FUTURE,
  ...extra,
});

const pkg = { workbook: { id: "w1", name: "Big run" }, datasets: [{}, {}] } as unknown as WorkbookTransferPackage;

const okParse = (text: string): ParseTransferResult => ({ ok: true, pkg: { text } as never, migrationWarnings: [] });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readTransferRef", () => {
  it("returns null for anything that is not a descriptor (inline packages, prose, long text)", () => {
    expect(readTransferRef('{"format":"quantized-workbook-transfer","version":1}')).toBeNull();
    expect(readTransferRef("hello")).toBeNull();
    expect(readTransferRef("[1,2]")).toBeNull();
    expect(readTransferRef(JSON.stringify(ref()) + " ".repeat(5000))).toBeNull();
  });

  it("parses a well-formed descriptor", () => {
    const r = readTransferRef(JSON.stringify(ref()));
    expect(r).toEqual({ ok: true, ref: ref() });
  });

  it("refuses an incompatible descriptor version with the version named", () => {
    const r = readTransferRef(JSON.stringify(ref({ version: 2 })));
    expect(r).toEqual({ ok: false, reason: "unsupported workbook transfer reference version: 2" });
  });

  it.each([
    ["path-shaped id", { id: `../${"0".repeat(29)}` }],
    ["upper-case id", { id: ID.toUpperCase() }],
    ["empty token", { token: "" }],
    ["short token", { token: "a".repeat(42) }],
    ["long token", { token: "a".repeat(44) }],
    ["newline in token (fetch would throw)", { token: `${"a".repeat(21)}\n${"a".repeat(21)}` }],
    ["non-Latin-1 token (fetch would throw)", { token: `${"a".repeat(42)}\u4e2d` }],
    ["padding char in token", { token: `${"a".repeat(42)}=` }],
    ["fractional size", { size: 1.5 }],
    ["zero size", { size: 0 }],
    ["bad expiry", { expiresAt: "soon" }],
  ])("refuses a malformed descriptor (%s)", (_label, extra) => {
    const r = readTransferRef(JSON.stringify(ref(extra as Partial<WorkbookTransferRef>)));
    expect(r).toEqual({ ok: false, reason: "clipboard text is not a valid Quantized transfer descriptor" });
  });
});

describe("storeAsReference", () => {
  it("stores the package and returns a small descriptor naming id, token, size and expiry", async () => {
    const text = '{"big":"é"}';
    const bytes = new TextEncoder().encode(text).length;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      const body = init?.body as Blob;
      expect(await body.text()).toBe(text);
      return new Response(JSON.stringify({ id: ID, token: TOK, size: bytes, expires_at: FUTURE, ttl_seconds: 86400 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await storeAsReference({ pkg, text }, 8_000_000);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workbook-transfer/packages");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text.length).toBeLessThan(600);
    const parsed = readTransferRef(out.text);
    expect(parsed?.ok && parsed.ref).toMatchObject({ id: ID, token: TOK, size: bytes, expiresAt: FUTURE });
    expect(parsed?.ok && parsed.ref.summary).toMatch(/^Quantized workbook "Big run" \(2 worksheets, 0\.0 MB\)/);
    expect(out.note).toMatch(/temporary transfer package/);
  });

  it("caps the workbook name in the summary so the descriptor stays small", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: ID, token: TOK, size: 3, expires_at: FUTURE, ttl_seconds: 1 }))),
    );
    const longName = { ...pkg, workbook: { id: "w1", name: "\u0001".repeat(5000) } } as WorkbookTransferPackage;
    const out = await storeAsReference({ pkg: longName, text: "abc" }, 8_000_000);
    expect(out.ok && out.text.length).toBeLessThan(1200);
    expect(out.ok && readTransferRef(out.text)?.ok).toBe(true);
  });

  it("discard() deletes the stored package with its token and never rejects", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE"
        ? Promise.reject(new TypeError("Failed to fetch"))
        : new Response(JSON.stringify({ id: ID, token: TOK, size: 3, expires_at: FUTURE, ttl_seconds: 1 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await storeAsReference({ pkg, text: "abc" }, 8_000_000);
    await expect(out.ok && out.discard?.()).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`/api/workbook-transfer/packages/${ID}`);
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>)["X-Transfer-Token"]).toBe(TOK);
  });

  it("refuses with the store named when the backend is unreachable (offline)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const out = await storeAsReference({ pkg, text: "x".repeat(10) }, 8_000_000);
    expect(out).toEqual({
      ok: false,
      reason: "workbook is 0.0 MB, over the 8.0 MB clipboard limit, and the temporary transfer store is unavailable (Failed to fetch)",
    });
  });

  it("refuses when the store answers with an error status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "transfer store unavailable" }), { status: 503 })));
    const out = await storeAsReference({ pkg, text: "abc" }, 8_000_000);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.reason).toMatch(/temporary transfer store is unavailable \(transfer store unavailable\)/);
  });

  it("refuses a store response whose size disagrees with what was sent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: ID, token: TOK, size: 1, expires_at: FUTURE, ttl_seconds: 1 }))),
    );
    const out = await storeAsReference({ pkg, text: "abc" }, 8_000_000);
    expect(out).toEqual({ ok: false, reason: "the temporary transfer store returned an unexpected response" });
  });

  it("refuses above the stored-package cap without uploading", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // multi-byte characters: the cap is on UTF-8 BYTES, not UTF-16 length —
    // 600,001 characters are 1,200,002 bytes, over a 1.2 MB cap
    const text = "é".repeat(600_001);
    const out = await storeAsReference({ pkg, text }, 8_000_000, 1_200_000);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.reason).toMatch(/too large to transfer \(1\.2 MB, limit 1\.2 MB\)/);
    expect(fetchMock).not.toHaveBeenCalled();
    // the real default mirrors the backend's MAX_PACKAGE_BYTES
    expect(MAX_STORED_TRANSFER_BYTES).toBe(128_000_000);
  });
});

describe("fetchReferencedPackage", () => {
  const serve = (status: number, body = "abc") =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init?: RequestInit) => new Response(status === 200 ? body : "{}", { status })),
    );

  it("fetches by id with the token in a header (never the URL) and parses the bytes", async () => {
    serve(200);
    const out = await fetchReferencedPackage(ref(), okParse);
    expect(out.ok).toBe(true);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/workbook-transfer/packages/${ID}`);
    expect(url).not.toContain(TOK);
    expect((init.headers as Record<string, string>)["X-Transfer-Token"]).toBe(TOK);
  });

  it("names an expired package (410)", async () => {
    serve(410);
    const out = await fetchReferencedPackage(ref(), okParse);
    expect(!out.ok && out.reason).toMatch(/temporary transfer package expired/);
  });

  it("names an expired package when a 404 arrives after the descriptor's expiry (already swept)", async () => {
    serve(404);
    const out = await fetchReferencedPackage(ref({ expiresAt: PAST }), okParse);
    expect(!out.ok && out.reason).toMatch(/expired/);
  });

  it("names a missing package (404 before expiry: evicted or deleted)", async () => {
    serve(404);
    const out = await fetchReferencedPackage(ref(), okParse);
    expect(!out.ok && out.reason).toMatch(/not available here \(removed, evicted, or copied on another computer or user account\) — copy the workbook again/);
  });

  it("names an unreachable store (offline destination)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const out = await fetchReferencedPackage(ref(), okParse);
    expect(!out.ok && out.reason).toMatch(/transfer store is unavailable \(Failed to fetch\)/);
  });

  it("refuses a partial package (byte count disagrees with the descriptor)", async () => {
    serve(200, "ab");
    const out = await fetchReferencedPackage(ref({ size: 3 }), okParse);
    expect(!out.ok && out.reason).toMatch(/incomplete \(2 of 3 bytes\)/);
  });

  it("passes an incompatible package's own reason through", async () => {
    serve(200);
    const parse = (): ParseTransferResult => ({ ok: false, reason: "unsupported workbook transfer version: 2" });
    const out = await fetchReferencedPackage(ref(), parse);
    expect(out).toEqual({ ok: false, reason: "temporary transfer package: unsupported workbook transfer version: 2" });
  });
});
