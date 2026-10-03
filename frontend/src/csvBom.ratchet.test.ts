// CSV downloads carry a UTF-8 BOM when they hold non-ASCII text.
//
// Excel on Windows reads a BOM-less CSV in the ANSI code page, so Å / ⁻¹ / µ
// arrive garbled. `csvBlob` (lib/csvCell.ts, the twin of the backend's
// `csv_safe.with_excel_bom`) adds the BOM only when the text needs it, so an
// ASCII file stays byte-identical. Every client-side CSV download builds its
// Blob through it: only lib/csvCell.ts may spell the "text/csv" type.
//
// Sabotage: build any one download with `new Blob([csv], { type: "text/csv" })`
// again and the ratchet names that file.

import { describe, expect, it } from "vitest";

import { csvBlob, withExcelBom } from "./lib/csvCell";

const modules = import.meta.glob("./**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

async function bytes(blob: Blob): Promise<number[]> {
  return [...new Uint8Array(await blob.arrayBuffer())];
}

describe("withExcelBom / csvBlob", () => {
  it("adds a BOM only for non-ASCII text, never twice", () => {
    expect(withExcelBom("a,b\n1,2\n")).toBe("a,b\n1,2\n");
    expect(withExcelBom("Q (Å^-1),R\n")).toBe("﻿Q (Å^-1),R\n");
    expect(withExcelBom("﻿µ")).toBe("﻿µ");
    expect(withExcelBom("")).toBe("");
  });

  it("writes the BOM bytes into the Blob", async () => {
    const plain = csvBlob("a,b\n");
    expect(plain.type).toBe("text/csv");
    expect(await bytes(plain)).toEqual([0x61, 0x2c, 0x62, 0x0a]);
    const accented = await bytes(csvBlob("µ\n"));
    expect(accented.slice(0, 3)).toEqual([0xef, 0xbb, 0xbf]);
    expect(accented.slice(3)).toEqual([0xc2, 0xb5, 0x0a]);
  });
});

describe("CSV download ratchet", () => {
  it("only lib/csvCell.ts spells the text/csv type", () => {
    const offenders = Object.entries(modules)
      .filter(([p]) => !/\.test\.(ts|tsx)$/.test(p) && !p.endsWith("/lib/csvCell.ts"))
      .filter(([, src]) => src.includes('"text/csv"'))
      .map(([p]) => p);
    expect(offenders).toEqual([]);
  });

  it("is not vacuous: the CSV downloads go through csvBlob", () => {
    const users = Object.entries(modules).filter(
      ([p, src]) => !/\.test\.(ts|tsx)$/.test(p) && /\bcsvBlob\(/.test(src) && !p.endsWith("/lib/csvCell.ts"),
    );
    expect(users.length).toBeGreaterThanOrEqual(7);
  });
});
